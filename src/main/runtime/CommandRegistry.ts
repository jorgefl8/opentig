import type { IpcResult } from '../../shared/contracts';
import { GitOperationError, serializeError } from '../../shared/errors';
import type { ProblemLogRecorder } from '../persistence/ProblemsLogStore';
import { recordProblemSafely } from '../persistence/ProblemsLogStore';
import {
  repositoryIdFromCommandArgs,
  shouldRecordCommandProblem,
} from '../../shared/problems-log';
import type {
  OpenTigServerCommandDefinition,
  OpenTigServerCommandMap,
  OpenTigServerCommandName,
} from '../../shared/protocol';

export interface CommandExecutionContext {
  readonly sessionId: string;
  readonly signal: AbortSignal;
  state<Value>(key: string, initialize: () => Value): Value;
  deleteState(key: string): void;
}

export interface CommandExecutionOptions {
  signal?: AbortSignal;
}

type CommandHandler = (
  context: CommandExecutionContext,
  args: readonly unknown[],
) => Promise<unknown> | unknown;

interface RegisteredCommand {
  definition: OpenTigServerCommandDefinition;
  handler: CommandHandler;
}

/** Validated transport-neutral execution boundary for server commands. */
export class CommandRegistry {
  private readonly commands = new Map<OpenTigServerCommandName, RegisteredCommand>();
  private readonly sessions = new Map<string, Map<string, unknown>>();
  private activeCommands = 0;
  private updating = false;

  pauseForUpdate(): boolean {
    if (this.activeCommands > 0 || this.updating) return false;
    this.updating = true;
    return true;
  }

  resumeAfterUpdate(): void { this.updating = false; }

  private problemLog: ProblemLogRecorder | null = null;

  setProblemLog(log: ProblemLogRecorder | null): void {
    this.problemLog = log;
  }

  register<Command extends OpenTigServerCommandName>(
    definition: OpenTigServerCommandDefinition & { command: Command },
    handler: (
      context: CommandExecutionContext,
      args: OpenTigServerCommandMap[Command]['args'],
    ) => Promise<OpenTigServerCommandMap[Command]['result']> | OpenTigServerCommandMap[Command]['result'],
  ): void {
    this.registerHandler(definition, handler as CommandHandler);
  }

  registerHandler(
    definition: OpenTigServerCommandDefinition,
    handler: CommandHandler,
  ): void {
    if (this.commands.has(definition.command)) {
      throw new Error(`Duplicate server command: ${definition.command}`);
    }
    this.commands.set(definition.command, {
      definition,
      handler,
    });
  }

  registeredCommands(): OpenTigServerCommandName[] {
    return [...this.commands.keys()];
  }

  async execute<Command extends OpenTigServerCommandName>(
    sessionId: string,
    command: Command,
    args: OpenTigServerCommandMap[Command]['args'],
    options?: CommandExecutionOptions,
  ): Promise<IpcResult<OpenTigServerCommandMap[Command]['result']>>;
  async execute(sessionId: string, command: string, args: unknown, options?: CommandExecutionOptions): Promise<IpcResult<unknown>>;
  async execute(sessionId: string, command: string, args: unknown, options: CommandExecutionOptions = {}): Promise<IpcResult<unknown>> {
    const registered = this.commands.get(command as OpenTigServerCommandName);
    const operation = registered?.definition.operation ?? 'command';
    try {
      if (!registered) throw invalidCommand(operation, 'Unknown server command.');
      if (!Array.isArray(args)) throw invalidCommand(operation, 'Command arguments must be an array.');
      if (!sessionId || sessionId.length > 200) throw invalidCommand(operation, 'Invalid session.');
      if (requestBytes(args) > registered.definition.maxRequestBytes) {
        throw invalidCommand(operation, 'Command request exceeded the safety limit.');
      }
      if (this.updating) throw invalidCommand(operation, 'The server is restarting to install an update. Try again after reconnecting.');
      const context = this.context(sessionId, options.signal);
      this.activeCommands += 1;
      try { return { ok: true, value: await registered.handler(context, args) }; }
      finally { this.activeCommands -= 1; }
    } catch (error) {
      const serialized = serializeError(error, operation);
      if (this.problemLog && shouldRecordCommandProblem({
        command,
        code: serialized.code,
        aborted: options.signal?.aborted === true,
        error,
      })) {
        recordProblemSafely(this.problemLog, {
          source: 'command',
          operation,
          code: serialized.code,
          message: serialized.message,
          repositoryId: repositoryIdFromCommandArgs(args),
        });
      }
      return { ok: false, error: serialized };
    }
  }

  sessionState<Value>(sessionId: string, key: string, initialize: () => Value): Value {
    return this.context(sessionId).state(key, initialize);
  }

  contextForSession(sessionId: string): CommandExecutionContext {
    return this.context(sessionId);
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clearSessionState(sessionId: string, key: string): void {
    this.sessions.get(sessionId)?.delete(key);
  }

  clear(): void {
    this.commands.clear();
    this.sessions.clear();
  }

  private context(sessionId: string, signal = NEVER_ABORTED_SIGNAL): CommandExecutionContext {
    let values = this.sessions.get(sessionId);
    if (!values) {
      values = new Map<string, unknown>();
      this.sessions.set(sessionId, values);
    }
    return {
      sessionId,
      signal,
      state: <Value>(key: string, initialize: () => Value): Value => {
        if (!values!.has(key)) values!.set(key, initialize());
        return values!.get(key) as Value;
      },
      deleteState: (key) => values!.delete(key),
    };
  }
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

function requestBytes(args: readonly unknown[]): number {
  try {
    let binaryBytes = 0;
    const serialized = JSON.stringify(args, (_key, value: unknown) => {
      if (!(value instanceof Uint8Array)) return value;
      binaryBytes += value.byteLength;
      return { binaryBytes: value.byteLength };
    });
    return Buffer.byteLength(serialized, 'utf8') + binaryBytes;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function invalidCommand(operation: string, message: string): GitOperationError {
  return new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message });
}
