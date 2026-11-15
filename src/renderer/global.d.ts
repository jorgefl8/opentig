import type { OpenTigDesktopApi } from '../shared/desktop-api';

declare global {
  /** Filled in by Vite. `BASE_URL` is where the app's public files are: `/` for the app, the demo's folder on the website. */
  interface ImportMetaEnv { readonly BASE_URL: string }
  interface ImportMeta { readonly env: ImportMetaEnv }
  interface Window {
    opentigDesktop?: OpenTigDesktopApi;
    __opentigPerformanceAutomation?: boolean;
    __opentigPerformanceResults?: Array<{
      kind: string;
      durationMs: number;
    }>;
    /** Requests made since the last performance action, by command, and how many are unanswered. */
    __opentigNavigationRequests?: () => { requested: Record<string, number>; unanswered: number };
  }
}

export {};
