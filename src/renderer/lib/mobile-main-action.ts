import type { PullRequestPrimary } from '../../shared/pull-request-actions';

export type PullRequestTab = 'summary' | 'comments' | 'checks' | 'timeline' | 'diff';

/** What a screen knows that decides its floating action. Each screen has at most one. */
export type MobileScreen =
  | { screen: 'changes'; stagedCount: number; hasCommitPlan: boolean }
  | { screen: 'file'; dirty: boolean; saving: boolean }
  | { screen: 'pull-request'; tab: PullRequestTab; primary: PullRequestPrimary['kind'] }
  | { screen: 'release'; isDraft: boolean; canWrite: boolean };

export type MobileMainActionKind = 'commit' | 'save' | 'pull-request-primary' | 'comment' | 'publish-release';

/** The one action that floats above a phone's bottom bar. Reading code, checks or the timeline floats nothing, so they keep the screen. */
export function mobileMainAction(screen: MobileScreen): MobileMainActionKind | null {
  switch (screen.screen) {
    case 'changes':
      return screen.stagedCount > 0 || screen.hasCommitPlan ? 'commit' : null;
    case 'file':
      return screen.dirty || screen.saving ? 'save' : null;
    case 'pull-request':
      if (screen.tab === 'comments') return 'comment';
      return screen.tab === 'summary' && (screen.primary === 'action' || screen.primary === 'github') ? 'pull-request-primary' : null;
    case 'release':
      return screen.isDraft && screen.canWrite ? 'publish-release' : null;
  }
}
