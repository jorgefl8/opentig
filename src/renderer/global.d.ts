import type { OpenTigDesktopApi } from '../shared/desktop-api';

declare global {
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
