import type { OpenTigApi } from '../shared/contracts';

declare global {
  interface Window {
    opentig: OpenTigApi;
    __justgitPerformanceAutomation?: boolean;
    __justgitPerformanceResults?: Array<{
      kind: string;
      durationMs: number;
    }>;
  }
}

export {};
