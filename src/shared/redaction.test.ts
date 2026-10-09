import { expect, it } from 'vitest';
import { redactSensitiveText } from './redaction';
it('removes GitHub credentials and complete HTTP authorization values from remote diagnostics', () => {
  const token = 'ghp_012345678901234567890123456789';
  const value = redactSensitiveText(`denied ${token}\nAuthorization: Basic YWxpY2U6c2VjcmV0\nhttps://alice:secret@github.com/team/repo?token=secret`);
  expect(value).not.toContain(token); expect(value).not.toContain('YWxpY2U6c2VjcmV0'); expect(value).not.toContain('secret');
  expect(value).toContain('github.com/team/repo');
});
