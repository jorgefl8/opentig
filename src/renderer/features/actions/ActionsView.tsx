import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { IconBolt, IconCheck, IconClock, IconExternalLink, IconFilter, IconGitCommit, IconGitPullRequest, IconLoader4, IconPlayerPlay, IconTag } from '@tabler/icons-react';
import { formatTimeAgo } from '@shared/date-format';
import type { GitHubRepositoryAccount } from '@shared/github-accounts';
import type { ActionRunSummary, RunnableWorkflow } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { GitHubSectionMenu } from '@/features/pulls/GitHubSectionMenu';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { GitHubAvatar } from '@/features/pulls/GitHubAvatar';
import { RepositoryLink } from '@/components/RepositoryLink';
import type { RepositoryLinkTarget } from '@/components/repository-links';
import { ActionStatusIcon } from './ActionStatusIcon';
import { RunWorkflowDialog } from './RunWorkflowDialog';
import { actionRunListOptions, latestActionRunsOptions, listedRunIds, runsOfPages } from './action-queries';
import { actionStatusLabel, actionTone, findStartedRun, formatDuration, runDuration, STARTED_RUN_REFRESH_MS, STARTED_RUN_WINDOW_MS, type StartedWorkflow } from './action-status';
import './actions.css';

/** --motion-med and --ease-out, as elsewhere in the app. */
const ROW_TRANSITION = { duration: 0.2, ease: [0.32, 0.72, 0, 1] as const };

export function ActionsTools({ repositoryId, nameWithOwner, account, onOpenGitHubSettings, workflowId, onWorkflowChange, onSelect }: {
  repositoryId: string;
  nameWithOwner: string | null;
  account: GitHubRepositoryAccount | null;
  onOpenGitHubSettings(): void;
  workflowId: number | null;
  onWorkflowChange(workflowId: number | null): void;
  onSelect(runId: number): void;
}) {
  const [running, setRunning] = useState(false);
  const queryClient = useQueryClient();
  const runs = useInfiniteQuery(actionRunListOptions(repositoryId, workflowId));
  // A workflow OpenTig just started: its runs are read every few seconds until the new one appears, which then opens.
  const [started, setStarted] = useState<StartedWorkflow | null>(null);
  const startedRuns = useQuery({ ...latestActionRunsOptions(repositoryId, started?.workflowId ?? null), enabled: started !== null, refetchInterval: STARTED_RUN_REFRESH_MS });
  useEffect(() => {
    if (!started) return;
    const run = startedRuns.data ? findStartedRun(startedRuns.data, started) : null;
    if (run) {
      setStarted(null);
      onSelect(run.id);
      return;
    }
    // Past the window the usual refresh still lists it; it just doesn't open by itself.
    const timer = window.setTimeout(() => setStarted(null), Math.max(0, started.requestedAt + STARTED_RUN_WINDOW_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [onSelect, started, startedRuns.data]);
  const onStarted = (workflow: RunnableWorkflow) => {
    setStarted({ workflowId: workflow.id, requestedAt: Date.now(), knownIds: listedRunIds(queryClient, repositoryId) });
    setRunning(false);
    // Keep the new run in the list when another workflow was filtered.
    if (workflowId !== null && workflowId !== workflow.id) onWorkflowChange(workflow.id);
  };
  const workflows = useQuery({ queryKey: queryKeys.workflows(repositoryId), queryFn: () => opentig.github.listWorkflows(repositoryId) });
  const sorted = [...(workflows.data?.workflows ?? [])].sort((left, right) => left.name.localeCompare(right.name));
  const choose = (next: number | null) => onWorkflowChange(next);
  return (
    <>
      <GitHubSectionMenu
        label="Filter workflow runs"
        icon={<IconFilter />}
        filtered={workflowId !== null}
        refreshing={runs.isFetching}
        refreshLabel="Refresh workflow runs"
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, 'action-runs'] });
          void queryClient.invalidateQueries({ queryKey: queryKeys.workflows(repositoryId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.runnableWorkflows(repositoryId) });
        }}
        nameWithOwner={nameWithOwner}
        githubPath="actions"
        account={account}
        onOpenGitHubSettings={onOpenGitHubSettings}
      >
        <span className="pulls-filter-title">Workflow</span>
        <div className="actions-workflow-filter" role="radiogroup" aria-label="Workflow">
          <button type="button" role="radio" aria-checked={workflowId === null} className="pulls-filter-option" onClick={() => choose(null)}>
            <IconCheck className={workflowId === null ? '' : 'invisible'} aria-hidden="true" /> All workflows
          </button>
          {workflows.isPending && <span className="pulls-filter-option" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> Loading workflows…</span>}
          {sorted.map((workflow) => (
            <button key={workflow.id} type="button" role="radio" aria-checked={workflowId === workflow.id} className="pulls-filter-option" onClick={() => choose(workflow.id)}>
              <IconCheck className={workflowId === workflow.id ? '' : 'invisible'} aria-hidden="true" /> {workflow.name}
            </button>
          ))}
        </div>
      </GitHubSectionMenu>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" onClick={() => setRunning(true)} aria-label={started ? 'Run a workflow (waiting for the started run to appear)' : 'Run a workflow'} />}>
          {started ? <IconLoader4 className="animate-spin" /> : <IconPlayerPlay />}
        </TooltipTrigger>
        <TooltipContent>{started ? 'Waiting for the run GitHub is starting…' : 'Run a workflow'}</TooltipContent>
      </Tooltip>
      {running && <RunWorkflowDialog repositoryId={repositoryId} initialWorkflowId={workflowId} onOpenRun={onSelect} onStarted={onStarted} onClose={() => setRunning(false)} />}
    </>
  );
}

export function ActionsView({ repositoryId, workflowId, activeRunId, onSelect }: { repositoryId: string; workflowId: number | null; activeRunId: number | null; onSelect(runId: number): void }) {
  const mobile = useMobileLayout();
  const reduceMotion = useReducedMotion();
  const query = useInfiniteQuery(actionRunListOptions(repositoryId, workflowId));
  const runs = query.data ? runsOfPages(query.data.pages) : null;
  const error = query.error instanceof Error ? query.error.message : query.error ? 'Could not load the workflow runs.' : null;
  // Durations are as of the last read; the list reads again every few seconds while a run is going.
  const now = query.dataUpdatedAt;
  return (
    <div className="pulls-view">
      {error && <div className="pulls-error" role="alert"><span>{error}</span><Button variant="ghost" size="xs" onClick={() => void query.refetch()}>Retry</Button></div>}
      <div className="pulls-scroll" role="list" aria-label="Workflow runs">
        {runs === null && !error && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading workflow runs…" /></div>}
        {runs?.length === 0 && <p className="empty-list">{workflowId === null ? 'No workflow runs yet.' : 'This workflow has no runs yet.'}</p>}
        {/* The first page just shows; runs that appear later, and pages loaded with Load more, fade in. */}
        <AnimatePresence initial={false}>
          {runs?.map((run) => (
            <motion.div
              key={run.id}
              role="listitem"
              className={`pull-item action-run-item ${run.id === activeRunId ? 'active' : ''}`}
              layout={reduceMotion ? false : 'position'}
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
              transition={ROW_TRANSITION}
            >
              <RunRow run={run} phone={mobile} now={now} onSelect={onSelect} />
            </motion.div>
          ))}
        </AnimatePresence>
        {query.hasNextPage && (
          <button type="button" className="actions-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? <ShimmeringText text="Loading…" /> : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}

const EVENT_ICONS: Record<string, typeof IconGitCommit> = {
  push: IconGitCommit, pull_request: IconGitPullRequest, pull_request_target: IconGitPullRequest, release: IconTag,
  workflow_dispatch: IconPlayerPlay, schedule: IconClock,
};

/** What started a run, as something OpenTig can open when it is a commit, a pull request or a release. */
function runReference(run: ActionRunSummary): { target: RepositoryLinkTarget | null; label: string; note: string } | null {
  const ran = `${run.workflowName} #${run.number} ran for this`;
  if (run.event === 'push' && /^[0-9a-f]{40}$/i.test(run.headSha)) return { target: { kind: 'commit', oid: run.headSha.toLowerCase() }, label: run.headSha.slice(0, 7), note: `${ran} commit.` };
  if (run.event.startsWith('pull_request') && run.pullRequestNumber) return { target: { kind: 'pull', number: run.pullRequestNumber }, label: `#${run.pullRequestNumber}`, note: `${ran} pull request.` };
  if (run.event === 'release' && run.branch) return { target: { kind: 'release', tag: run.branch }, label: run.branch, note: `${ran} release.` };
  return run.branch ? { target: null, label: run.branch, note: '' } : null;
}

/** Scheduled runs are GitHub's own; naming its bot adds nothing. */
function startedBy(run: ActionRunSummary): string | null {
  return run.event === 'schedule' || !run.actor ? null : run.actor.login;
}

/**
 * The whole row opens the run. It's a button under the row's contents, so the
 * reference beside the event icon can be a button of its own without nesting.
 */
function RunRow({ run, phone, now, onSelect }: { run: ActionRunSummary; phone: boolean; now: number; onSelect(runId: number): void }) {
  const tone = actionTone(run.status, run.conclusion);
  const duration = runDuration(run, now);
  const status = actionStatusLabel(run.status, run.conclusion);
  const reference = runReference(run);
  const by = startedBy(run);
  const EventIcon = EVENT_ICONS[run.event] ?? IconBolt;
  return (
    <>
      <button
        type="button"
        className="action-run-open"
        onClick={() => onSelect(run.id)}
        aria-label={`${run.title || `Run ${run.number}`}, ${run.workflowName} #${run.number}, ${status}${by ? `, started by ${by}` : ''}`}
      />
      <span className="action-run-body" aria-hidden="true">
        <span className="pull-avatar-status action-run-avatar">
          <GitHubAvatar key={run.actor?.avatarUrl ?? ''} src={run.actor?.avatarUrl ?? null} className="pull-avatar" />
          <span className="action-run-badge"><ActionStatusIcon tone={tone} /></span>
        </span>
        <span className="pull-line">
          <span className="pull-title">{run.title || `Run ${run.number}`}</span>
          <time className="pull-age" dateTime={run.createdAt}>{formatTimeAgo(run.createdAt)}</time>
        </span>
        <span className="pull-line action-run-meta">
          <span className="action-run-workflow">{run.workflowName}</span>
          <span className="action-run-event">
            <EventIcon aria-hidden="true" />
            {reference && (reference.target
              ? <RepositoryLink target={reference.target} note={reference.note} className="action-run-ref" fallback={<span className="action-run-ref plain">{reference.label}</span>}>{reference.label}</RepositoryLink>
              : <span className="action-run-ref plain">{reference.label}</span>)}
          </span>
          {by && <span className="action-run-by">by {by}</span>}
          <span className="action-run-duration">{run.status === 'queued' || run.status === 'waiting' || run.status === 'pending' ? status : duration !== null ? formatDuration(duration) : status}</span>
        </span>
      </span>
      {!phone && <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button pull-open-external" onClick={() => openOnGitHub(run.url)} aria-label={`Open run ${run.number} on GitHub`} />}>
          <IconExternalLink />
        </TooltipTrigger>
        <TooltipContent>Open on GitHub</TooltipContent>
      </Tooltip>}
    </>
  );
}
