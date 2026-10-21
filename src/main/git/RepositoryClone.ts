import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rmdir } from 'node:fs/promises';
import path from 'node:path';
import type { RepositoryInfo } from '../../shared/contracts';
import { cloneFailureMessage, cloneInputError, parseCloneProgress, type CloneJob, type CloneRepositoryInput } from '../../shared/onboarding';
import type { GitProcess } from './GitProcess';

// Large repositories over slow links take a long time; only cancellation should stop them early.
const CLONE_TIMEOUT_MS = 6 * 60 * 60_000;
// Finished jobs stay readable so a client that reconnects can still collect the result.
const FINISHED_JOB_TTL_MS = 30 * 60_000;

type Progress = Pick<CloneJob, 'phase' | 'percent' | 'received'>;

/** A clone only reserves a new directory; it never replaces an existing path. */
export async function cloneRepository(git: GitProcess, input: CloneRepositoryInput, signal: AbortSignal, progress: (value: Progress) => void): Promise<string> {
  const error = cloneInputError(input);
  if (error) throw new Error(error);
  if (!path.isAbsolute(input.parentPath)) throw new Error('Choose an absolute destination folder path.');
  let parent: string;
  try { parent = await realpath(input.parentPath); }
  catch (reason) { throw new Error('The destination folder does not exist.', { cause: reason }); }
  const destination = path.join(parent, input.folderName);
  signal.throwIfAborted();
  try { await mkdir(destination); }
  catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This destination already exists. Choose another repository folder name.', { cause: reason });
    throw new Error('Could not create the repository folder. Check the destination and its permissions.', { cause: reason });
  }
  progress({ phase: 'Connecting to remote', percent: null, received: null });
  let pending = '';
  let diagnostics = '';
  try {
    await git.run(parent, ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.http.allow=always', '-c', 'protocol.ssh.allow=always',
      'clone', '--progress', '--', input.url, destination], {
      operation: 'clone-repository', timeoutMs: CLONE_TIMEOUT_MS, maxOutputBytes: 64 * 1024 * 1024, signal,
      onStderr(chunk) {
        const lines = (pending + chunk).split(/[\r\n]/);
        pending = (lines.pop() ?? '').slice(-4096);
        for (const line of lines) {
          const parsed = parseCloneProgress(line);
          if (parsed) progress(parsed);
          else if (line.trim()) diagnostics = (diagnostics + '\n' + line).slice(-4096);
        }
      },
    });
    signal.throwIfAborted();
    return destination;
  } catch (reason) {
    // Only remove an empty reservation. Partial data is retained, never recursively deleted.
    let retained = false;
    try { await rmdir(destination); } catch (removeError) { retained = (removeError as NodeJS.ErrnoException).code !== 'ENOENT'; }
    const message = signal.aborted ? 'Clone cancelled.' : cloneFailureMessage(`${diagnostics}\n${pending}\n${reason instanceof Error ? reason.message : ''}`);
    throw new Error(`${message}${retained ? ' The destination contains partial data and has been kept. Choose another folder name to retry.' : ''}`, { cause: reason });
  }
}

export class CloneJobs {
  private readonly jobs = new Map<string, { job: CloneJob; controller: AbortController }>();

  constructor(private readonly git: GitProcess, private readonly prepare: (destination: string) => Promise<RepositoryInfo>) {}

  start(input: CloneRepositoryInput): CloneJob {
    const error = cloneInputError(input);
    if (error) throw new Error(error);
    if ([...this.jobs.values()].some(entry => entry.job.state === 'running')) throw new Error('Another repository is still being cloned. Wait for it to finish or cancel it.');
    const job: CloneJob = { id: randomUUID(), name: input.folderName, destination: path.join(input.parentPath, input.folderName), state: 'running', phase: 'Preparing destination', percent: null, received: null, repository: null, error: null };
    const controller = new AbortController();
    this.jobs.set(job.id, { job, controller });
    void this.run(job, input, controller.signal);
    return { ...job };
  }

  get(id: string): CloneJob | null {
    const entry = this.jobs.get(id);
    return entry ? { ...entry.job } : null;
  }

  cancel(id: string): void {
    const entry = this.jobs.get(id);
    if (entry?.job.state === 'running') entry.controller.abort();
  }

  close(): void {
    for (const entry of this.jobs.values()) entry.controller.abort();
  }

  private async run(job: CloneJob, input: CloneRepositoryInput, signal: AbortSignal): Promise<void> {
    try {
      job.destination = await cloneRepository(this.git, input, signal, value => Object.assign(job, value));
      job.phase = 'Opening repository'; job.percent = 100;
      job.repository = await this.prepare(job.destination);
      job.state = 'completed'; job.phase = 'Repository cloned';
    } catch (reason) {
      job.state = signal.aborted ? 'cancelled' : 'failed';
      job.phase = signal.aborted ? 'Clone cancelled' : 'Clone failed';
      job.error = reason instanceof Error ? reason.message : 'Could not clone the repository.';
    }
    setTimeout(() => this.jobs.delete(job.id), FINISHED_JOB_TTL_MS).unref?.();
  }
}
