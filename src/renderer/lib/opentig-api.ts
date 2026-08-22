import type { OpenTigApi } from '@shared/contracts';
import { createOpenTigServerClient } from './server-client';

export const serverClient = createOpenTigServerClient();

const desktop = window.opentigDesktop;
const server = serverClient.api;

/** Renderer facade: domain calls use the server; only native affordances use preload. */
export const opentig: OpenTigApi = {
  ...server,
  app: {
    ...server.app,
    capabilities: async () => {
      const capabilities = await server.app.capabilities();
      return {
        ...capabilities,
        runtimeMode: desktop ? 'desktop' : capabilities.runtimeMode,
        nativePicker: Boolean(desktop),
        fileClipboard: Boolean(desktop),
        revealInFileManager: Boolean(desktop),
      };
    },
    setPreferences: async (preferences) => {
      const result = await server.app.setPreferences(preferences);
      await desktop?.app.preferencesChanged(result);
      return result;
    },
    setZoomFactor: (factor) => {
      if (desktop) desktop.app.setZoomFactor(factor);
      else document.documentElement.style.zoom = String(Math.max(0.8, Math.min(1.3, Number(factor) || 1)));
    },
    setTitleBarTheme: (dark) => desktop?.app.setTitleBarTheme(dark) ?? Promise.resolve(),
  },
  clipboard: {
    readFilePaths: () => desktop?.clipboard.readFilePaths() ?? Promise.resolve([]),
    readImagePng: () => desktop?.clipboard.readImagePng() ?? Promise.resolve(null),
  },
  repository: {
    ...server.repository,
    select: async (title) => {
      if (desktop) return desktop.repository.select(title);
      const value = window.prompt(title ?? 'Repository path on the OpenTig server');
      return value?.trim() || null;
    },
    selectRelocation: async (repositoryName, previousPath) => {
      if (desktop) return desktop.repository.selectRelocation(repositoryName, previousPath);
      const value = window.prompt(`New server path for ${repositoryName}`, previousPath);
      return value?.trim() || null;
    },
    revealEntry: (repositoryId, path) => desktop?.repository.revealEntry(repositoryId, path)
      ?? Promise.reject(new Error('Reveal in file manager is available only in the desktop app.')),
  },
};
