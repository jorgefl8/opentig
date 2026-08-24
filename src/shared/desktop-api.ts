import type { OpenTigApi, Preferences } from './contracts';

export const OPEN_TIG_DESKTOP_IPC = {
  preferencesChanged: 'desktop:preferences-changed',
  titleBarTheme: 'desktop:title-bar-theme',
  clipboardReadFilePaths: 'desktop:clipboard-read-file-paths',
  clipboardReadImagePng: 'desktop:clipboard-read-image-png',
  repositorySelect: 'desktop:repository-select',
  repositorySelectRelocation: 'desktop:repository-select-relocation',
  repositoryRevealEntry: 'desktop:repository-reveal-entry',
  webAccessStatus: 'desktop:web-access-status',
  webAccessSetEnabled: 'desktop:web-access-set-enabled',
  webAccessSetExternalOrigin: 'desktop:web-access-set-external-origin',
  webAccessCreatePairingLink: 'desktop:web-access-create-pairing-link',
} as const;

export interface OpenTigWebAccessStatus {
  enabled: boolean;
  serverState: 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped';
  actualPort: number | null;
  localEndpoint: string | null;
  networkEndpoints: string[];
  pairingEndpoints: string[];
  externalOrigin: string | null;
  connectedSessionCount: number;
  restartError: string | null;
}

export interface OpenTigPairingLink {
  url: string;
  expiresAt: string;
}

export interface OpenTigWebAccessApi {
  getStatus(): Promise<OpenTigWebAccessStatus>;
  setEnabled(enabled: boolean): Promise<OpenTigWebAccessStatus>;
  setExternalOrigin(origin: string | null): Promise<OpenTigWebAccessStatus>;
  createPairingLink(endpoint: string): Promise<OpenTigPairingLink>;
}

/**
 * Native desktop capabilities kept outside the server. Text clipboard and
 * external links are renderer-local browser actions and never enter preload.
 */
export interface OpenTigDesktopApi {
  app: Pick<OpenTigApi['app'], 'setZoomFactor' | 'setTitleBarTheme'> & {
    preferencesChanged(preferences: Preferences): Promise<void>;
  };
  clipboard: OpenTigApi['clipboard'];
  repository: Pick<OpenTigApi['repository'], 'select' | 'selectRelocation'> & {
    /** Absolute path already resolved and authorized by the server. */
    revealEntry(target: string): Promise<void>;
  };
  webAccess: OpenTigWebAccessApi;
}
