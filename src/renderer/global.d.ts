import type { OpenTigApi } from '../shared/contracts';

declare global {
  interface Window {
    opentig: OpenTigApi;
    __opentigPerformanceAutomation?: boolean;
    __opentigPerformanceResults?: Array<{
      kind: string;
      durationMs: number;
    }>;
  }
}

export {};
