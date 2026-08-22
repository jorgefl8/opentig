import type { IpcResult } from '../../../src/shared/contracts';

/** Removes credential-shaped values before an operation error crosses the wire. */
export function redactOperationResult(result: IpcResult<unknown>): IpcResult<unknown> {
  if (result.ok) return result;
  const error = { ...result.error, message: redactSensitiveText(result.error.message) };
  if ('stderr' in error) delete error.stderr;
  return { ok: false, error };
}

export function redactSensitiveText(value: string): string {
  const withoutHeaders = value
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  return withoutHeaders.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => redactUrl(candidate));
}

function redactUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    if (url.username || url.password) {
      url.username = '[redacted]';
      url.password = '';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[redacted-url]';
  }
}
