import { redactSensitiveText } from '../../shared/redaction';
import { startupBackground } from './WindowTitleBar';

export const SERVER_RECOVERY_URLS = {
  restart: 'https://opentig.invalid/server-recovery/restart',
  openLog: 'https://opentig.invalid/server-recovery/open-log',
} as const;

/** Recovery is available only from this window's exact locally generated error page. */
export function serverRecoveryAction(currentUrl: string, errorPageUrl: string | null, targetUrl: string): 'restart' | 'openLog' | null {
  if (!errorPageUrl || currentUrl !== errorPageUrl) return null;
  if (targetUrl === SERVER_RECOVERY_URLS.restart) return 'restart';
  if (targetUrl === SERVER_RECOVERY_URLS.openLog) return 'openLog';
  return null;
}

export function serverErrorPageUrl(options: {
  displayName: string;
  dark: boolean;
  logPath: string;
  appVersion: string;
  error: unknown;
}): string {
  const { dark } = options;
  const background = startupBackground(dark);
  const foreground = dark ? '#f4f4f4' : '#1a1a1a';
  const muted = dark ? '#a3a3a3' : '#5c5c5c';
  const ring = dark ? '#FAFAFA' : '#1a1a1a';
  const heading = escapeHtml(options.displayName + ' server is offline');
  const error = options.error;
  const code = error instanceof Error && 'code' in error ? String(error.code) + ': ' : '';
  const message = escapeHtml(redactSensitiveText(code + (error instanceof Error ? error.message : 'The server could not start.')));
  const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 117.9 128" aria-hidden="true"><path fill="${ring}" d="m113.9 42.6c-3.7-11.3-10.8-21.2-20.1-28.6-7.4-5.7-16.1-10-25.4-11.5-6.5-0.9-9.4-1.1-15.9-0.3-7.4 0.9-14.3 3.4-20.7 7-15.4 9.1-27.6 26.2-29.8 44.5-0.3 2.9-0.4 5.8-0.2 8.7 0.7 15.5 9.7 33.2 27.2 44.1l3.9 2.2c1.5 1.3 2.9 1.8 5.1 1.3 3.5-0.9 5.1-6.1 0.1-8.6-7.3-3.5-13.7-8.7-18.1-14.6-5-7-9-15.8-9.3-26.9-0.2-10 3.5-21.4 11.6-31.3 4.5-5.2 10.5-9.8 16.4-12.7 10.1-4.9 20.5-6.6 31.2-3.8 13.2 3.5 25.6 13.1 32.3 26.5 2.3 4.9 4.2 10.7 4.9 17.4 0.9 9.9-1.4 19.2-6.9 27.4-4.3 6.5-9.2 11-16.1 15.8l-4.1 2.1c-4.4 2.4-3.2 9.4 2.8 9 1.2 0 2.5-0.8 3.6-1.4 3.9-2 7.5-4.3 10.8-7 9.4-8 17.6-20.3 19.1-36.8 0.6-7.4-0.4-15.6-2.4-22.5z"/><path fill="#2266ea" d="m88.1 42.8c-3.6 0.3-7.4 2.9-9 7.3-5.5 0.8-14.1 3.6-20.3 12-4.3-6.3-11.6-10.7-19.7-12-1.1-3.8-5-7.5-10.2-7.2-4.1 0.4-8.7 3.8-8.7 9.7 0.2 6 5.7 10.3 11.1 9.3 2.8-0.3 5.2-2 6.6-4.3 6.7 1 14.9 4.7 17.3 14.1v36.7c-3.2 1.5-5.5 4.7-5.5 8.4 0 4.8 3.7 9.3 9.4 9.3s9.5-4.5 9.4-9.1c0.1-3.6-2.3-7.3-5.8-8.7v-36.4c1-5.6 5.9-10.9 13.3-13.3l3.9-1c1.8 2.9 4.9 4.6 8.6 4.5 4.6-0.2 9.3-3.6 9.3-9.5 0-5.6-4.9-10-9.7-9.8z"/></svg>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{min-height:100%;margin:0;background:${background};color:${muted};font-family:system-ui,sans-serif}body{min-height:100vh;display:flex;align-items:center;justify-content:center}main{max-width:620px;padding:32px 24px;text-align:center}.logo{width:48px;height:52px;margin:0 auto 24px}.logo svg{width:100%;height:100%}h1{font-size:22px;font-weight:650;letter-spacing:-.02em;margin:0 0 12px;color:${foreground}}p{font-size:14px;line-height:1.6;margin:10px 0}.error{color:${foreground};overflow-wrap:anywhere;white-space:pre-wrap}.actions{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin:24px 0}.button{display:inline-block;border:1px solid ${muted};border-radius:8px;padding:10px 16px;color:${foreground};font-size:14px;font-weight:600;text-decoration:none}.primary{background:#2266ea;border-color:#2266ea;color:#fff}.button:hover{filter:brightness(1.15)}.button:focus-visible{outline:2px solid #2266ea;outline-offset:4px}.log{font-size:12px;overflow-wrap:anywhere}code{font-family:ui-monospace,monospace}</style></head><body><main><div class="logo">${logo}</div><h1>${heading}</h1><p class="error">${message}</p><p>Restart the application to try again. If this keeps happening, open the server log for details.</p><div class="actions"><a class="button primary" href="${SERVER_RECOVERY_URLS.restart}">Restart ${escapeHtml(options.displayName)}</a><a class="button" href="${SERVER_RECOVERY_URLS.openLog}">Open server log</a></div><p class="log">Server log: <code>${escapeHtml(options.logPath)}</code><br>Version ${escapeHtml(options.appVersion)}</p></main></body></html>`;
  return 'data:text/html;charset=UTF-8,' + encodeURIComponent(html);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
