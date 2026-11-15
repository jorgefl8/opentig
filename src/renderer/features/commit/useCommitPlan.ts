import { useEffect, useRef, useState } from 'react';
import type { CommitSplitProposal, OpenTigApi } from '@shared/contracts';
import type { RepositoryStatus } from '@shared/git-types';
import {
  activeStep, commitPlanReducer, committedCount, fileKinds, NO_COMMIT_PLAN, pendingIndices, pendingPaths, planMessage, stagedMatches, stagedPaths,
  type CommitPlan, type CommitPlanAction, type CommitPlanMode, type CommitPlanOutcome, type CommitPlanStep, type PlannedCommit,
} from './commit-plan';

interface CommitPlanOptions {
  repositoryId: string | undefined;
  status: RepositoryStatus | null;
  /** The text in the commit box, which holds the active group's message while splitting. Read when it is needed, so typing redraws nothing here. */
  getMessage(): string;
  setMessage(message: string): void;
  index: Pick<OpenTigApi['index'], 'prepareCommitGroup' | 'stage'>;
}

export interface CommitPlanController {
  plan: CommitPlan | null;
  outcome: CommitPlanOutcome | null;
  /** The commit the box is about to create, while the plan is being followed. */
  step: CommitPlanStep | null;
  /** A generation answered with this plan, or with none. */
  propose(proposal: CommitSplitProposal | null, message: string): void;
  clear(): void;
  /** The index was changed outside the plan, so it stops and says why. */
  pause(reason: string): void;
  /** Stages the first group, or everything again. Rejects if the files can't be staged again. */
  chooseMode(mode: CommitPlanMode): Promise<void>;
  /** Stages one group through the server's checks. A refusal pauses the plan with its reason. */
  activate(index: number): Promise<void>;
  /** Stages again what the plan hasn't committed and ends it. Rejects if that fails, leaving the plan. */
  discard(): Promise<void>;
  /** The step to commit, or false once what is staged no longer matches it. Null without a plan in progress. */
  stepToCommit(): CommitPlanStep | null | false;
  /** The active group was committed: marks it and stages the next one. */
  committed(commit: PlannedCommit): Promise<void>;
}

/**
 * A suggested split of the staged files, followed one commit at a time. Only the
 * index is changed here; every commit is still created by the app on a click.
 */
export function useCommitPlan({ repositoryId, status, getMessage, setMessage, index }: CommitPlanOptions): CommitPlanController {
  const [model, setModel] = useState(NO_COMMIT_PLAN);
  // Read after an await, where the render that started the work is out of date.
  const live = useRef({ model, status, repositoryId });
  useEffect(() => { Object.assign(live.current, { status, repositoryId }); });
  const dispatch = (action: CommitPlanAction) => {
    const next = commitPlanReducer(live.current.model, action);
    live.current.model = next;
    setModel(next);
  };

  // A plan belongs to the repository it was made for.
  useEffect(() => {
    live.current.model = NO_COMMIT_PLAN;
    setModel(NO_COMMIT_PLAN);
  }, [repositoryId]);

  const activate = async (target: number, expectedStagedPaths = stagedPaths(live.current.status?.changes)) => {
    const plan = live.current.model.plan;
    const group = plan?.proposal.commits[target];
    const repository = live.current.repositoryId;
    if (!plan || !group || !repository || plan.committed[target]) return;
    try {
      await index.prepareCommitGroup({ repositoryId: repository, paths: group.paths, expectedStagedPaths, expectedFingerprint: group.fingerprint });
    } catch (reason) {
      if (live.current.repositoryId === repository) dispatch({ type: 'paused', reason: reason instanceof Error ? reason.message : 'The files could not be staged.' });
      return;
    }
    if (live.current.repositoryId !== repository) return;
    dispatch({ type: 'activated', index: target, outgoing: getMessage() });
    const current = live.current.model.plan;
    if (current) setMessage(planMessage(current, target));
  };

  /** What the plan unstaged goes back, which is everything it hasn't committed. */
  const restage = async (plan: CommitPlan): Promise<number> => {
    const paths = pendingPaths(plan);
    if (live.current.repositoryId && paths.length > 0) await index.stage(live.current.repositoryId, paths);
    return paths.length;
  };

  return {
    plan: model.plan,
    outcome: model.outcome,
    step: activeStep(model.plan),
    propose: (proposal, text) => dispatch({ type: 'proposed', proposal, message: text, kinds: fileKinds(live.current.status?.changes) }),
    clear: () => dispatch({ type: 'cleared' }),
    pause: (reason) => dispatch({ type: 'paused', reason }),
    activate,
    chooseMode: async (mode) => {
      const plan = live.current.model.plan;
      if (!plan || plan.mode === mode || committedCount(plan) > 0) return;
      if (mode === 'split') return activate(pendingIndices(plan)[0]!);
      const repository = live.current.repositoryId;
      await restage(plan);
      if (live.current.repositoryId !== repository) return;
      dispatch({ type: 'single', outgoing: getMessage() });
      const current = live.current.model.plan;
      if (current) setMessage(planMessage(current, 'one'));
    },
    discard: async () => {
      const plan = live.current.model.plan;
      if (!plan) return;
      // A paused plan no longer knows what should be staged, and one commit never changed it.
      if (plan.paused !== null || plan.mode === 'one') return dispatch({ type: 'cleared' });
      const repository = live.current.repositoryId;
      const restaged = await restage(plan);
      if (live.current.repositoryId !== repository) return;
      const committed = committedCount(plan);
      dispatch({ type: 'discarded', restaged });
      // The single message described every file, so it only fits while none is committed.
      setMessage(committed === 0 ? planMessage(plan, 'one') : '');
    },
    stepToCommit: () => {
      const step = activeStep(live.current.model.plan);
      if (!step) return null;
      if (stagedMatches(step.group, live.current.status?.changes)) return step;
      dispatch({ type: 'paused', reason: `The staged files no longer match commit ${step.position} of ${step.total}.` });
      return false;
    },
    committed: async (commit) => {
      if (!activeStep(live.current.model.plan)) return;
      dispatch({ type: 'committed', commit });
      const plan = live.current.model.plan;
      // The commit took everything staged, whatever this render still shows.
      if (plan) await activate(pendingIndices(plan)[0]!, []);
    },
  };
}
