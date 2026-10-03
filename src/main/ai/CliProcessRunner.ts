import { cleanEnvironment } from './CliEnvironment';
import { execa } from 'execa';
import { AiOperationError } from '../../shared/errors';
import { resolveProcessCommand } from '../process/resolveProcessCommand';

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
  private readonly active = new Set<AbortController>();
  private readonly idleWaiters = new Set<() => void>();
  private closePromise: Promise<void> | null = null;

  async run(command: string, args: string[], options: CliRunOptions = {}): Promise<CliRunResult> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
    const environment = cleanEnvironment(Object.fromEntries(
      Object.entries({ ...process.env, ...options.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ));
    for (const key of options.removeEnv ?? []) delete environment[key];

    if (this.closePromise || options.signal?.aborted) throw cancelled();
    const lifecycle = new AbortController();
    this.active.add(lifecycle);
    const signal = options.signal
      ? AbortSignal.any([options.signal, lifecycle.signal])
      : lifecycle.signal;
    let resolvedCommand;
    let result;
    try {
      resolvedCommand = resolveProcessCommand(command, options.cwd ?? process.cwd(), environment);
      result = await execa(resolvedCommand.file, args, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        cancelSignal: signal,
        env: environment,
        extendEnv: false,
        shell: false,
        windowsHide: true,
        cleanup: true,
        killDescendants: true,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        input: options.stdin ?? '',
        stripFinalNewline: false,
        reject: false,
      }).catch((error: unknown) => {
        if (signal.aborted) throw cancelled();
        throw processFailed(error);
      });
    } finally {
      this.active.delete(lifecycle);
      if (this.active.size === 0) {
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
    }

    if (result.isCanceled) throw cancelled();
    if (result.timedOut) {
      throw new AiOperationError({ code: 'AI_TIMEOUT', operation: 'ai-process', message: 'Generation took too long.', retryable: true });
    }
    if (result.isMaxBuffer) {
      throw new AiOperationError({ code: 'AI_CONTEXT_TOO_LARGE', operation: 'ai-process', message: 'The AI tool produced too much output.' });
    }
    if (result.exitCode === undefined || !resolvedCommand.found) {
      throw processFailed(result);
    }
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  close(timeoutMs = 2_000): Promise<void> {
    this.closePromise ??= this.closeOwnedProcesses(timeoutMs);
    return this.closePromise;
  }

  private async closeOwnedProcesses(timeoutMs: number): Promise<void> {
    for (const controller of this.active) controller.abort();
    if (this.active.size === 0) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        this.idleWaiters.delete(finish);
        resolve();
      };
      const timeout = setTimeout(finish, timeoutMs);
      this.idleWaiters.add(finish);
    });
  }
}

function cancelled(): AiOperationError {
  return new AiOperationError({ code: 'AI_CANCELLED', operation: 'ai-process', message: 'Generation canceled.' });
}

export class CliLaunchError extends AiOperationError {
  constructor(readonly reason: 'missing' | 'permission' | 'format' | 'unknown') {
    super({ code: 'AI_PROCESS_FAILED', operation: 'ai-process', message: 'Could not start the AI tool.' });
  }
}

function processFailed(error?: unknown): CliLaunchError {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return new CliLaunchError(code === 'ENOENT' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'permission' : code === 'ENOEXEC' ? 'format' : 'unknown');
}
