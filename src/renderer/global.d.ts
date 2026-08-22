import type { OpenTigDesktopApi } from '../shared/desktop-api';

declare global {
  interface Window {
    opentigDesktop?: OpenTigDesktopApi;
    __opentigPerformanceAutomation?: boolean;
    __opentigPerformanceResults?: Array<{
      kind: string;
      durationMs: number;
    }>;
  }
}

export {};
