import type { OpenTigApi } from './contracts';

/**
 * Native desktop capabilities kept outside the server. Text clipboard and
 * external links are renderer-local browser actions and never enter preload.
 */
export interface OpenTigDesktopApi {
  app: Pick<OpenTigApi['app'], 'setZoomFactor' | 'setTitleBarTheme'>;
  clipboard: OpenTigApi['clipboard'];
  repository: Pick<OpenTigApi['repository'], 'select' | 'selectRelocation' | 'revealEntry'>;
}
