import { describe, expect, it } from 'vitest';
import { redactOperationResult, redactSensitiveText } from './redact';

describe('server error redaction', () => {
  it('removes headers, secrets, URL credentials, query, fragment, and stderr', () => {
    const message = redactSensitiveText('Authorization: bearer-value token=pair-value https://user:pass@example.com/repo?key=value#fragment');
    expect(message).not.toContain('bearer-value');
    expect(message).not.toContain('pair-value');
    expect(message).not.toContain('user');
    expect(message).not.toContain('pass');
    expect(message).not.toContain('key=value');
    expect(message).not.toContain('fragment');

    const result = redactOperationResult({
      ok: false,
      error: { code: 'UNKNOWN', operation: 'push', message, stderr: 'private file contents' },
    });
    expect(result).toEqual({ ok: false, error: { code: 'UNKNOWN', operation: 'push', message } });
  });
});
