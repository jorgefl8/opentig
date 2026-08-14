import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { GitOperationError } from '../../shared/errors';

export interface GitOutput {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

interface RunOptions {
  operation: string;
  readOnly?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string | Buffer;
}

const activeChildren = new Set<number>();

/**
 * Two spellings of the same directory must share one queue. Collapsing case and
 * separators can only over-serialize, never let two writers through at once.
 */
function normalizeLockKey(value: string): string {
  const unified = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

export class GitProcess {
  private readonly writeQueues = new Map<string, Promise<void>>();

  run(cwd: string, args: string[], options: RunOptions): Promise<GitOutput> {
    const globalArgs = ['--no-pager'];
    if (options.readOnly) globalArgs.push('--no-optional-locks');
    return this.spawnGit(cwd, [...globalArgs, ...args], options);
  }

  /**
   * `lockKey` serializes against a queue other than `cwd` without changing the
   * directory Git runs in. Branch and worktree management pass the repository's
   * common dir so sibling worktrees, which share refs and worktree metadata,
   * cannot mutate them concurrently.
   */
  async runWrite(cwd: string, args: string[], options: RunOptions, lockKey?: string): Promise<GitOutput> {
    return this.withWriteLock(lockKey ?? cwd, () => this.run(cwd, args, options));
  }

  async runWriteTask<T>(cwd: string, task: (run: (args: string[], options: RunOptions) => Promise<GitOutput>) => Promise<T>, lockKey?: string): Promise<T> {
    return this.withWriteLock(lockKey ?? cwd, () => task((args, options) => this.run(cwd, args, options)));
  }

  private async withWriteLock<T>(rawKey: string, task: () => Promise<T>): Promise<T> {
    const key = normalizeLockKey(rawKey);
    const previous = this.writeQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.writeQueues.set(key, queued);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.writeQueues.get(key) === queued) this.writeQueues.delete(key);
    }
  }

  hasActiveProcess(): boolean {
    return activeChildren.size > 0;
  }

  private spawnGit(cwd: string, args: string[], options: RunOptions): Promise<GitOutput> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn('git', args, {
          cwd,
          shell: false,
          windowsHide: true,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_EDITOR: 'true',
            GIT_SEQUENCE_EDITOR: 'true',
            LC_ALL: 'C',
          },
        });
      } catch (error) {
        reject(this.mapError(options.operation, error));
        return;
      }

      if (child.pid) activeChildren.add(child.pid);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputSize = 0;
      let timedOut = false;
      let overLimit = false;

      const terminate = () => {
        if (!child.pid || child.killed) return;
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);

      const collect = (target: Buffer[], chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > maxOutputBytes) {
          overLimit = true;
          terminate();
          return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
      child.on('error', (error) => {
        clearTimeout(timer);
        if (child.pid) activeChildren.delete(child.pid);
        reject(this.mapError(options.operation, error));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (child.pid) activeChildren.delete(child.pid);
        const out = Buffer.concat(stdout);
        const err = Buffer.concat(stderr);
        if (timedOut) {
          reject(new GitOperationError({ code: 'TIMEOUT', operation: options.operation, message: `Git took too long during ${options.operation}.` }));
          return;
        }
        if (overLimit) {
          reject(new GitOperationError({ code: 'OUTPUT_LIMIT', operation: options.operation, message: 'Git output exceeded the safety limit.' }));
          return;
        }
        if ((code ?? 1) !== 0) {
          reject(this.fromExit(options.operation, code ?? 1, err.toString('utf8')));
          return;
        }
        resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
      });

      if (options.stdin !== undefined) child.stdin.end(options.stdin);
      else child.stdin.end();
    });
  }

  private mapError(operation: string, error: unknown): GitOperationError {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return new GitOperationError({ code: 'GIT_NOT_FOUND', operation, message: 'Git was not found in PATH.' });
    }
    return new GitOperationError({ code: 'UNKNOWN', operation, message: error instanceof Error ? error.message : 'Could not start Git.' });
  }

  private fromExit(operation: string, exitCode: number, stderr: string): GitOperationError {
    const lower = stderr.toLowerCase();
    let code: 'NOT_REPOSITORY' | 'DIRTY_WORKTREE' | 'HOOK_REJECTED' | 'LOCKED_INDEX' | 'UNKNOWN' = 'UNKNOWN';
    if (lower.includes('not a git repository')) code = 'NOT_REPOSITORY';
    else if (lower.includes('index.lock') || lower.includes('another git process')) code = 'LOCKED_INDEX';
    else if (lower.includes('local changes') || lower.includes('would be overwritten')) code = 'DIRTY_WORKTREE';
    else if (operation === 'commit') code = 'HOOK_REJECTED';
    return new GitOperationError({
      code,
      operation,
      message: stderr.trim() || `Git exited with code ${exitCode}.`,
      stderr: stderr.trim(),
      exitCode,
    });
  }
}
