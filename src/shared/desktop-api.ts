import type { OpenTigApi, Preferences } from './contracts';

export const OPEN_TIG_DESKTOP_IPC = {
  preferencesChanged: 'desktop:preferences-changed',
  titleBarTheme: 'desktop:title-bar-theme',
  clipboardReadFilePaths: 'desktop:clipboard-read-file-paths',
  clipboardReadImagePng: 'desktop:clipboard-read-image-png',
  repositorySelect: 'desktop:repository-select',
  repositorySelectRelocation: 'desktop:repository-select-relocation',
  repositoryRevealEntry: 'desktop:repository-reveal-entry',
} as const;

/**
 * Native desktop capabilities kept outside the server. Text clipboard and
 * external links are renderer-local browser actions and never enter preload.
 */
export interface OpenTigDesktopApi {
  app: Pick<OpenTigApi['app'], 'setZoomFactor' | 'setTitleBarTheme'> & {
    preferencesChanged(preferences: Preferences): Promise<void>;
  };
  clipboard: OpenTigApi['clipboard'];
  repository: Pick<OpenTigApi['repository'], 'select' | 'selectRelocation' | 'revealEntry'>;
}
