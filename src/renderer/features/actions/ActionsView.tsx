import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCheck, IconExternalLink, IconFilter, IconLoader4, IconPlayerPlay } from '@tabler/icons-react';
import { formatTimeAgo } from '@shared/date-format';
import type { GitHubRepositoryAccount } from '@shared/github-accounts';
import type { ActionRunSummary, RepositoryWorkflow } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { GitHubSectionMenu } from '@/features/pulls/GitHubSectionMenu';
import { RunWorkflowDialog } from '@/features/pulls/RunWorkflowDialog';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { ActionStatusIcon } from './ActionStatusIcon';
import { actionStatusLabel, actionTone, findStartedRun, formatDuration, runDuration, runListRefreshInterval, STARTED_RUN_REFRESH_MS, STARTED_RUN_WINDOW_MS, type StartedWorkflow } from './action-status';
import './actions.css';

function actionRunsQueryOptions(repositoryId: string, workflowId: number | null) {
  return {
    queryKey: queryKeys.actionRuns(repositoryId, workflowId),
    queryFn: () => opentig.github.listActionRuns(repositoryId, workflowId),
    // Only while the tab is showing and the window is visible: the tab unmounts the list, and hidden windows don't poll.
    refetchInterval: (query: { state: { data?: ActionRunSummary[] | undefined } }) => runListRefreshInterval(query.state.data),
  };
}

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
  const runs = useQuery(actionRunsQueryOptions(repositoryId, workflowId));
  // A workflow OpenTig just started: its runs are read every few seconds until the new one appears, which then opens.
  const [started, setStarted] = useState<StartedWorkflow | null>(null);
  const startedRuns = useQuery({ ...actionRunsQueryOptions(repositoryId, started?.workflowId ?? null), enabled: started !== null, refetchInterval: STARTED_RUN_REFRESH_MS });
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
  const onStarted = (workflow: RepositoryWorkflow) => {
    const listed = queryClient.getQueriesData<ActionRunSummary[]>({ queryKey: ['repository', repositoryId, 'action-runs'] });
    setStarted({ workflowId: workflow.id, requestedAt: Date.now(), knownIds: new Set(listed.flatMap(([, data]) => data?.map((run) => run.id) ?? [])) });
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
  const query = useQuery(actionRunsQueryOptions(repositoryId, workflowId));
  const runs = query.data ?? null;
  const error = query.error instanceof Error ? query.error.message : query.error ? 'Could not load the workflow runs.' : null;
  // Only finished runs show a duration, so the time of the read is enough.
  const now = query.dataUpdatedAt;
  return (
    <div className="pulls-view">
      {error && <div className="pulls-error" role="alert"><span>{error}</span><Button variant="ghost" size="xs" onClick={() => void query.refetch()}>Retry</Button></div>}
      <div className="pulls-scroll" role="list" aria-label="Workflow runs">
        {runs === null && !error && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading workflow runs…" /></div>}
        {runs?.length === 0 && <p className="empty-list">{workflowId === null ? 'No workflow runs yet.' : 'This workflow has no runs yet.'}</p>}
        {runs?.map((run) => <RunRow key={run.id} run={run} active={run.id === activeRunId} phone={mobile} now={now} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

function RunRow({ run, active, phone, now, onSelect }: { run: ActionRunSummary; active: boolean; phone: boolean; now: number; onSelect(runId: number): void }) {
  const tone = actionTone(run.status, run.conclusion);
  const duration = runDuration(run, now);
  const state = run.status === 'completed' && duration !== null ? formatDuration(duration) : actionStatusLabel(run.status, run.conclusion);
  return (
    <div className={`pull-item ${active ? 'active' : ''}`} role="listitem">
      <button className="pull-main action-run-row" onClick={() => onSelect(run.id)} aria-label={`${run.title}, ${run.workflowName} #${run.number}, ${actionStatusLabel(run.status, run.conclusion)}`}>
        <span className="action-run-icon"><ActionStatusIcon tone={tone} /></span>
        <span className="pull-line">
          <span className="pull-title">{run.title || `Run ${run.number}`}</span>
          <time className="pull-age" dateTime={run.createdAt}>{formatTimeAgo(run.createdAt)}</time>
        </span>
        <span className="pull-line">
          <span className="pull-meta">{run.workflowName} #{run.number} · {state}</span>
          {run.branch && <span className="pull-author action-run-branch">· {run.branch}</span>}
        </span>
      </button>
      {!phone && <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button pull-open-external" onClick={() => openOnGitHub(run.url)} aria-label={`Open run ${run.number} on GitHub`} />}>
          <IconExternalLink />
        </TooltipTrigger>
        <TooltipContent>Open on GitHub</TooltipContent>
      </Tooltip>}
    </div>
  );
}
