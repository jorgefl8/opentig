import { execa } from 'execa';
import { GitOperationError } from '../../shared/errors';
import { resolveProcessCommand } from '../process/resolveProcessCommand';

export interface GitOutput {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  /** Set when `truncateOverflow` cut the output short at the safety limit. */
  truncated?: boolean;
}

interface RunOptions {
  operation: string;
  readOnly?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  stdin?: string | Buffer;
  /**
   * Resolve with the output collected so far instead of failing when it reaches
   * the safety limit. Only for commands whose output is a list the caller can
   * legitimately present as incomplete, such as searching.
   */
  truncateOverflow?: boolean;
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

  private async spawnGit(cwd: string, args: string[], options: RunOptions): Promise<GitOutput> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    const environment = Object.fromEntries(
      Object.entries({
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
        LC_ALL: 'C',
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const resolvedCommand = resolveProcessCommand('git', cwd, environment);
    const outputLimit = new AbortController();
    let outputSize = 0;
    let overLimit = false;
    const enforceCombinedLimit = function* (chunk: Uint8Array): Generator<Uint8Array> {
      if (overLimit) return;
      if (outputSize + chunk.byteLength > maxOutputBytes) {
        overLimit = true;
        outputLimit.abort();
        return;
      }
      outputSize += chunk.byteLength;
      yield chunk;
    };

    let childPid: number | undefined;
    try {
      const subprocess = execa(resolvedCommand.file, args, {
        cwd,
        env: environment,
        extendEnv: false,
        shell: false,
        windowsHide: true,
        cleanup: true,
        killDescendants: true,
        timeout: timeoutMs,
        cancelSignal: outputLimit.signal,
        input: options.stdin ?? Buffer.alloc(0),
        encoding: 'buffer',
        stripFinalNewline: false,
        maxBuffer: maxOutputBytes,
        stdout: enforceCombinedLimit,
        stderr: enforceCombinedLimit,
        reject: false,
      });
      childPid = subprocess.pid;
      if (childPid) activeChildren.add(childPid);
      const result = await subprocess;
      const stdout = Buffer.from(result.stdout);
      const stderr = Buffer.from(result.stderr);

      if (overLimit || result.isMaxBuffer) {
        if (options.truncateOverflow) return { stdout, stderr, exitCode: 0, truncated: true };
        throw new GitOperationError({ code: 'OUTPUT_LIMIT', operation: options.operation, message: 'Git output exceeded the safety limit.' });
      }
      if (result.timedOut) {
        throw new GitOperationError({ code: 'TIMEOUT', operation: options.operation, message: `Git took too long during ${options.operation}.` });
      }
      if (result.exitCode === undefined || !resolvedCommand.found) {
        throw this.mapError(options.operation, Object.assign(new Error('Git was not found in PATH.'), { code: 'ENOENT' }));
      }
      if (result.exitCode !== 0) throw this.fromExit(options.operation, result.exitCode, stderr.toString('utf8'));
      return { stdout, stderr, exitCode: result.exitCode };
    } catch (error) {
      if (error instanceof GitOperationError) throw error;
      throw this.mapError(options.operation, error);
    } finally {
      if (childPid) activeChildren.delete(childPid);
    }
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
