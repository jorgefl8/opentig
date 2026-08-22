import type { IpcResult } from '../../../src/shared/contracts';
import { redactSensitiveText } from '../../../src/shared/redaction';

export { redactSensitiveText } from '../../../src/shared/redaction';

/** Removes credential-shaped values before an operation error crosses the wire. */
export function redactOperationResult(result: IpcResult<unknown>): IpcResult<unknown> {
  if (result.ok) return result;
  const error = { ...result.error, message: redactSensitiveText(result.error.message) };
  if ('stderr' in error) delete error.stderr;
  return { ok: false, error };
}
