import { describe, expect, it } from 'vitest';
import { SERVER_RECOVERY_URLS, serverErrorPageUrl, serverRecoveryAction } from './ServerErrorPage';

function errorPage(error: unknown = new Error('Server stopped')): string {
  return serverErrorPageUrl({ displayName: 'OpenTig', dark: true, logPath: 'C:\\Users\\Owner\\logs\\server.log', appVersion: '0.2.0', error });
}

describe('desktop server recovery', () => {
  it('allows restart and opening the log only from the exact local error page', () => {
    const page = errorPage();
    expect(serverRecoveryAction(page, page, SERVER_RECOVERY_URLS.restart)).toBe('restart');
    expect(serverRecoveryAction(page, page, SERVER_RECOVERY_URLS.openLog)).toBe('openLog');
    for (const current of ['http://127.0.0.1:6767/', 'https://example.com', 'data:text/html,untrusted']) {
      expect(serverRecoveryAction(current, page, SERVER_RECOVERY_URLS.restart)).toBeNull();
      expect(serverRecoveryAction(current, page, SERVER_RECOVERY_URLS.openLog)).toBeNull();
    }
    expect(serverRecoveryAction(page, null, SERVER_RECOVERY_URLS.restart)).toBeNull();
    expect(serverRecoveryAction(page, page, `${SERVER_RECOVERY_URLS.openLog}?path=C:/other-file`)).toBeNull();
  });

  it('shows the error code, recovery controls, version and log path without executable error text or credentials', () => {
    const page = errorPage(Object.assign(new Error('<script>alert(1)</script> token=private-token'), { code: 'EACCES' }));
    const html = decodeURIComponent(page.slice(page.indexOf(',') + 1));
    expect(html).toContain('EACCES: &lt;script&gt;alert(1)&lt;/script&gt; token=[redacted]');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('private-token');
    expect(html).toContain('Restart OpenTig');
    expect(html).toContain('Open server log');
    expect(html).toContain('Version 0.2.0');
    expect(html).toContain('C:\\Users\\Owner\\logs\\server.log');
    expect(html).toContain("default-src 'none'");
  });
});
