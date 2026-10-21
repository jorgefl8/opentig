import { sileo } from 'sileo';
import type { RepositoryInfo } from '@shared/contracts';
import type { CloneJob } from '@shared/onboarding';
import { opentig } from '@/lib/opentig-api';

const ACTIVE_JOB_KEY = 'opentig.cloneJob';
const PARENT_KEY = 'opentig.cloneParent';
const POLL_MS = 500;

/**
 * Follows a server clone job until it finishes. Request failures while the
 * connection is down are retried: the job itself keeps running on the server.
 */
export async function followCloneJob(id: string, onUpdate: (job: CloneJob) => void, signal?: AbortSignal): Promise<CloneJob> {
  rememberActiveCloneJob(id);
  // About two minutes of failed polls, enough for the connection to recover.
  let failuresLeft = 240;
  for (;;) {
    signal?.throwIfAborted();
    let job: CloneJob | null | undefined;
    try { job = await opentig.repository.cloneStatus(id); failuresLeft = 240; }
    catch (reason) { failuresLeft -= 1; if (failuresLeft === 0) throw reason; }
    if (job === null) { forgetActiveCloneJob(id); throw new Error('The clone was interrupted because the server restarted. Choose another folder name to try again.'); }
    if (job) {
      onUpdate(job);
      if (job.state !== 'running') { forgetActiveCloneJob(id); return job; }
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

/** Keeps a clone visible as a notification after its dialog closes. */
export function trackCloneInBackground(job: Pick<CloneJob, 'id' | 'name'>, onOpen: (repository: RepositoryInfo) => void): void {
  void sileo.promise(followCloneJob(job.id, () => undefined).then(result => {
    if (result.state === 'completed' && result.repository) return result.repository;
    throw new Error(result.error ?? 'Could not clone the repository.');
  }), {
    loading: { title: `Cloning ${job.name}…` },
    success: repository => ({ title: `${job.name} cloned`, duration: null, button: { title: 'Open', onClick: () => onOpen(repository) } }),
    error: reason => ({ title: `Could not clone ${job.name}`, description: reason instanceof Error ? reason.message : undefined, duration: 10_000 }),
  }).catch(() => undefined);
}

/** After a reload, picks up a clone that was still running on the server. */
export async function resumeBackgroundClone(onOpen: (repository: RepositoryInfo) => void): Promise<void> {
  let id: string | null;
  try { id = sessionStorage.getItem(ACTIVE_JOB_KEY); } catch { return; }
  if (!id) return;
  const job = await opentig.repository.cloneStatus(id).catch(() => null);
  if (!job) { forgetActiveCloneJob(id); return; }
  trackCloneInBackground(job, onOpen);
}

export function lastCloneParent(): string | null {
  try { return localStorage.getItem(PARENT_KEY); } catch { return null; }
}

export function rememberCloneParent(path: string): void {
  try { localStorage.setItem(PARENT_KEY, path); } catch { /* Storage is optional. */ }
}

function rememberActiveCloneJob(id: string): void {
  try { sessionStorage.setItem(ACTIVE_JOB_KEY, id); } catch { /* Storage is optional. */ }
}

function forgetActiveCloneJob(id: string): void {
  try { if (sessionStorage.getItem(ACTIVE_JOB_KEY) === id) sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch { /* Storage is optional. */ }
}
