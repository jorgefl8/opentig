import type { CommitPlanItem, CommitSplitProposal } from '@shared/contracts';
import type { ChangeKind, FileChange } from '@shared/git-types';

/** One commit for everything staged, or the plan's commits one after another. */
export type CommitPlanMode = 'one' | 'split';

export interface PlannedCommit {
  oid: string;
  /** The subject it was committed with, which the user may have edited. */
  subject: string;
}

export interface CommitPlan {
  proposal: CommitSplitProposal;
  mode: CommitPlanMode;
  /** The group whose files are staged and whose message is in the box. */
  activeIndex: number | null;
  /** By group index, so numbering never shifts as commits are made. */
  committed: Readonly<Record<number, PlannedCommit>>;
  /** Messages as last left in the box, by group index; `one` is the single commit's. */
  drafts: Readonly<Record<string, string>>;
  /** What each file was when the plan was made, for the groups already committed. */
  kinds: Readonly<Record<string, ChangeKind>>;
  /** Why the plan can't go on. It stays on screen with the reason instead of vanishing. */
  paused: string | null;
}

/** What a plan leaves to say once it is over. */
export type CommitPlanOutcome =
  | { kind: 'finished'; commits: PlannedCommit[] }
  | { kind: 'discarded'; restaged: number; committed: number };

export interface CommitPlanModel {
  plan: CommitPlan | null;
  outcome: CommitPlanOutcome | null;
}

export type CommitPlanAction =
  /** A generation answered. `message` is its single-commit message. */
  | { type: 'proposed'; proposal: CommitSplitProposal | null; message: string; kinds: Readonly<Record<string, ChangeKind>> }
  /** Group `index` is now what is staged. `outgoing` is the text the box held until then. */
  | { type: 'activated'; index: number; outgoing: string }
  /** Everything left is staged again as one commit. */
  | { type: 'single'; outgoing: string }
  /** The active group was committed. */
  | { type: 'committed'; commit: PlannedCommit }
  | { type: 'paused'; reason: string }
  | { type: 'discarded'; restaged: number }
  /** Nothing of the plan, nor of what it left to say, stays. */
  | { type: 'cleared' };

export const NO_COMMIT_PLAN: CommitPlanModel = { plan: null, outcome: null };

export function commitPlanReducer(model: CommitPlanModel, action: CommitPlanAction): CommitPlanModel {
  if (action.type === 'cleared') return model.plan || model.outcome ? NO_COMMIT_PLAN : model;
  if (action.type === 'proposed') {
    if (!action.proposal) return NO_COMMIT_PLAN;
    // Nothing is staged differently until the user chooses to split.
    return { outcome: null, plan: { proposal: action.proposal, mode: 'one', activeIndex: null, committed: {}, drafts: { one: action.message }, kinds: action.kinds, paused: null } };
  }
  const plan = model.plan;
  // With no plan left, staging by hand only ends what the last one had to say.
  if (!plan) return action.type === 'paused' && model.outcome ? NO_COMMIT_PLAN : model;
  switch (action.type) {
    case 'activated':
      if (!plan.proposal.commits[action.index] || plan.committed[action.index]) return model;
      return { outcome: null, plan: { ...plan, mode: 'split', activeIndex: action.index, drafts: withOutgoing(plan, action.outgoing), paused: null } };
    case 'single':
      // Commits already made can't be folded back into one.
      if (committedCount(plan) > 0) return model;
      return { outcome: null, plan: { ...plan, mode: 'one', activeIndex: null, drafts: withOutgoing(plan, action.outgoing), paused: null } };
    case 'committed': {
      if (plan.mode !== 'split' || plan.activeIndex === null) return model;
      const committed = { ...plan.committed, [plan.activeIndex]: action.commit };
      if (plan.proposal.commits.every((_, index) => committed[index])) {
        return { plan: null, outcome: { kind: 'finished', commits: plan.proposal.commits.map((_, index) => committed[index]!) } };
      }
      return { outcome: null, plan: { ...plan, committed, activeIndex: null } };
    }
    case 'paused':
      return { outcome: null, plan: { ...plan, paused: action.reason } };
    case 'discarded':
      return { plan: null, outcome: { kind: 'discarded', restaged: action.restaged, committed: committedCount(plan) } };
  }
}

/** The text in the box belongs to whatever was active, so leaving it keeps the edit. */
function withOutgoing(plan: CommitPlan, outgoing: string): CommitPlan['drafts'] {
  if (plan.mode === 'one') return { ...plan.drafts, one: outgoing };
  if (plan.activeIndex === null || plan.committed[plan.activeIndex]) return plan.drafts;
  return { ...plan.drafts, [plan.activeIndex]: outgoing };
}

export const committedCount = (plan: CommitPlan): number => Object.keys(plan.committed).length;

/** Groups still to commit, in the order the plan gave them. */
export function pendingIndices(plan: CommitPlan): number[] {
  return plan.proposal.commits.map((_, index) => index).filter((index) => !plan.committed[index]);
}

/** Every file of the groups still to commit: what was staged before the plan, less what it committed. */
export function pendingPaths(plan: CommitPlan): string[] {
  return pendingIndices(plan).flatMap((index) => plan.proposal.commits[index]!.paths);
}

/** The message for a group, or for the single commit, as last edited. */
export function planMessage(plan: CommitPlan, target: number | 'one'): string {
  return plan.drafts[target] ?? (target === 'one' ? '' : plan.proposal.commits[target]?.message ?? '');
}

export interface CommitPlanStep {
  index: number;
  group: CommitPlanItem;
  /** "2" of "Commit 2 of 3". */
  position: number;
  total: number;
}

/** The commit the box is about to create, when the plan is being followed. */
export function activeStep(plan: CommitPlan | null): CommitPlanStep | null {
  if (!plan || plan.mode !== 'split' || plan.paused !== null || plan.activeIndex === null) return null;
  const group = plan.proposal.commits[plan.activeIndex];
  if (!group || plan.committed[plan.activeIndex]) return null;
  return { index: plan.activeIndex, group, position: plan.activeIndex + 1, total: plan.proposal.commits.length };
}

/** What is staged right now, the way the server compares it before preparing a group. */
export function stagedPaths(changes: readonly FileChange[] | undefined): string[] {
  return (changes ?? []).filter((change) => change.staged && !change.conflict).map((change) => change.path).sort();
}

/** Whether exactly this group is staged, so its commit holds what its card lists. */
export function stagedMatches(group: CommitPlanItem, changes: readonly FileChange[] | undefined): boolean {
  const staged = stagedPaths(changes);
  const expected = [...group.paths].sort();
  return staged.length === expected.length && staged.every((path, index) => path === expected[index]);
}

/** Which diff shows a file as it stands now. Null once it has no local change left. */
export function planFileDiffKind(path: string, changes: readonly FileChange[] | undefined): 'staged' | 'unstaged' | null {
  const change = changes?.find((item) => item.path === path);
  if (!change || change.conflict) return null;
  return change.staged ? 'staged' : change.unstaged ? 'unstaged' : null;
}

export function fileKinds(changes: readonly FileChange[] | undefined): Record<string, ChangeKind> {
  return Object.fromEntries((changes ?? []).map((change) => [change.path, change.kind]));
}
