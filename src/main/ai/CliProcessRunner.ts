import crossSpawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { AiOperationError } from '../../shared/errors';

export interface CliRunOptions {
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  removeEnv?: string[];
  env?: Record<string, string>;
}

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CliProcessRunner {
  run(command: string, args: string[], options: CliRunOptions = {}): Promise<CliRunResult> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
    const environment: NodeJS.ProcessEnv = { ...process.env, ...options.env };
    for (const key of options.removeEnv ?? []) delete environment[key];

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(cancelled());
        return;
      }
      const child = crossSpawn(command, args, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env: environment,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let settled = false;
      let timedOut = false;

      const finish = (error?: Error, result?: CliRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else if (result) resolve(result);
      };
      const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
        const next = Buffer.concat([current, chunk]);
        if (next.byteLength > maxOutputBytes) {
          void terminateTree(child);
          finish(new AiOperationError({ code: 'AI_CONTEXT_TOO_LARGE', operation: 'ai-process', message: 'The AI tool produced too much output.' }));
        }
        return next;
      };
      child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.on('error', () => finish(new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-process', message: 'Could not start the AI tool.' })));
      child.on('close', (code) => {
        if (timedOut) return;
        finish(undefined, { exitCode: code ?? -1, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
      });

      const onAbort = () => {
        void terminateTree(child);
        finish(cancelled());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        void terminateTree(child);
        finish(new AiOperationError({ code: 'AI_TIMEOUT', operation: 'ai-process', message: 'Generation took too long.', retryable: true }));
      }, timeoutMs);

      if (options.stdin !== undefined) child.stdin?.end(options.stdin, 'utf8');
      else child.stdin?.end();
    });
  }
}

function cancelled(): AiOperationError {
  return new AiOperationError({ code: 'AI_CANCELLED', operation: 'ai-process', message: 'Generation canceled.' });
}

async function terminateTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true });
      killer.once('close', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}
