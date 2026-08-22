import type { OpenTigApi } from './contracts';

/**
 * Native desktop and renderer-local capabilities kept outside the server.
 * Text clipboard and external links remain in this compatibility surface until
 * the renderer switches to browser APIs in Plan 002.
 */
export interface OpenTigDesktopApi {
  app: Pick<OpenTigApi['app'], 'setZoomFactor' | 'setTitleBarTheme'>;
  clipboard: OpenTigApi['clipboard'];
  shell: OpenTigApi['shell'];
  repository: Pick<OpenTigApi['repository'], 'select' | 'revealEntry'>;
}
