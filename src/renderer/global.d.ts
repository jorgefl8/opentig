import type { JustGitApi } from '../shared/contracts';

declare global {
  interface Window {
    justgit: JustGitApi;
    __justgitPerformanceAutomation?: boolean;
    __justgitPerformanceResults?: Array<{
      kind: string;
      durationMs: number;
    }>;
  }
}

export {};
