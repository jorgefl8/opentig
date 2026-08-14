import type { AiHarnessId } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import type { CliRunResult } from '../CliProcessRunner';

export function requireSuccess(result: CliRunResult, harness: AiHarnessId, operation: string): void {
  if (result.exitCode === 0) return;
  const raw = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (/not logged|login required|unauth|authentication|sign in/.test(raw)) {
    throw new AiOperationError({ code: 'AI_AUTH_REQUIRED', operation, harness, message: `Sign in to ${label(harness)} to generate the message.` });
  }
  if (/rate.?limit|quota|usage limit|too many requests|credit/.test(raw)) {
    throw new AiOperationError({ code: 'AI_RATE_LIMITED', operation, harness, message: `${label(harness)} rejected the request because of a usage limit.`, exitCode: result.exitCode, retryable: true });
  }
  if (/model.*(not found|unavailable|invalid|access)|unknown model/.test(raw)) {
    throw new AiOperationError({ code: 'AI_MODEL_UNAVAILABLE', operation, harness, message: 'The selected model is unavailable.', exitCode: result.exitCode });
  }
  throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation, harness, message: `${label(harness)} could not generate the message.`, exitCode: result.exitCode, retryable: true });
}

export function label(harness: AiHarnessId): string {
  return harness === 'codex' ? 'Codex' : harness === 'claude' ? 'Claude Code' : 'OpenCode';
}

export function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}
