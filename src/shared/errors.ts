export type GitErrorCode =
  | 'NOT_REPOSITORY'
  | 'DIRTY_WORKTREE'
  | 'HOOK_REJECTED'
  | 'GIT_NOT_FOUND'
  | 'LOCKED_INDEX'
  | 'INVALID_ARGUMENT'
  | 'OUTPUT_LIMIT'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface SerializedGitError {
  code: GitErrorCode;
  operation: string;
  message: string;
  stderr?: string;
  exitCode?: number;
}

export type AiErrorCode =
  | 'AI_CLI_NOT_FOUND'
  | 'AI_AUTH_REQUIRED'
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'AI_PROCESS_FAILED'
  | 'AI_INVALID_OUTPUT'
  | 'AI_CONTEXT_TOO_LARGE'
  | 'AI_STAGED_CHANGES_CHANGED';

export interface SerializedAiError {
  code: AiErrorCode;
  operation: string;
  message: string;
  harness?: 'codex' | 'claude' | 'opencode';
  exitCode?: number;
  retryable?: boolean;
}

export type GhErrorCode =
  | 'GH_CLI_NOT_FOUND'
  | 'GH_AUTH_REQUIRED'
  | 'GH_NOT_GITHUB_REPO'
  | 'GH_NO_UPSTREAM'
  | 'GH_RATE_LIMITED'
  | 'GH_TIMEOUT'
  | 'GH_PROCESS_FAILED'
  | 'GH_INVALID_OUTPUT';

export interface SerializedGhError {
  code: GhErrorCode;
  operation: string;
  message: string;
  exitCode?: number;
  retryable?: boolean;
}

export type SerializedOperationError = SerializedGitError | SerializedAiError | SerializedGhError;

export class GitOperationError extends Error {
  readonly detail: SerializedGitError;

  constructor(detail: SerializedGitError) {
    super(detail.message);
    this.name = 'GitOperationError';
    this.detail = detail;
  }
}

export class AiOperationError extends Error {
  readonly detail: SerializedAiError;

  constructor(detail: SerializedAiError) {
    super(detail.message);
    this.name = 'AiOperationError';
    this.detail = detail;
  }
}

export class GhOperationError extends Error {
  readonly detail: SerializedGhError;

  constructor(detail: SerializedGhError) {
    super(detail.message);
    this.name = 'GhOperationError';
    this.detail = detail;
  }
}

export function serializeError(error: unknown, operation = 'unknown'): SerializedOperationError {
  if (error instanceof GitOperationError || error instanceof AiOperationError || error instanceof GhOperationError) return error.detail;
  if (error instanceof Error) {
    return { code: 'UNKNOWN', operation, message: error.message };
  }
  return { code: 'UNKNOWN', operation, message: 'Unknown error' };
}

export function serializedErrorFromReason(reason: unknown): SerializedOperationError | null {
  if (!reason || typeof reason !== 'object' || !('detail' in reason)) return null;
  const detail = (reason as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object') return null;
  const record = detail as Partial<SerializedOperationError>;
  return typeof record.code === 'string' && typeof record.operation === 'string' && typeof record.message === 'string'
    ? record as SerializedOperationError
    : null;
}
