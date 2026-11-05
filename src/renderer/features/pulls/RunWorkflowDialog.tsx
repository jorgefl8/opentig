import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCircleCheck, IconCircleX, IconClock, IconLoader4, IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { formatDateTime } from '@shared/date-format';
import type { RepositoryWorkflow, WorkflowRunSummary } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ghDetail, ghErrorTitle, isUncertainFailure, openOnGitHub } from './gh-utils';
import { useGitHubAccount } from './useGitHubAccount';

function RunIcon({ run }: { run: WorkflowRunSummary }) {
  if (run.conclusion === 'success') return <IconCircleCheck className="text-[var(--diff-added)]" aria-label="Succeeded" />;
  if (run.status === 'completed') return <IconCircleX className="text-destructive" aria-label={run.conclusion ?? 'Finished'} />;
  return <IconClock className="text-[var(--git-push)]" aria-label="In progress" />;
}

export function RunWorkflowDialog({ repositoryId, initialWorkflowId = null, onOpenRun, onStarted, onClose }: {
  repositoryId: string;
  /** The workflow to start with, such as the one the list is filtered by. */
  initialWorkflowId?: number | null;
  /** Opens a run in OpenTig; without it, runs open on GitHub. */
  onOpenRun?: ((runId: number) => void) | undefined;
  /** GitHub accepted the request; its run appears a few seconds later. */
  onStarted?: ((workflow: RepositoryWorkflow) => void) | undefined;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const listQuery = useQuery({ queryKey: queryKeys.workflows(repositoryId), queryFn: () => opentig.github.listWorkflows(repositoryId) });
  const list = listQuery.data;
  const [selected, setSelected] = useState<RepositoryWorkflow | null>(null);
  const workflow = selected ?? list?.workflows.find((item) => item.id === initialWorkflowId) ?? list?.workflows[0] ?? null;
  const [confirming, setConfirming] = useState(false);
  // A run with no answer may have started. Repeating it could start it twice, so the runs come first.
  const [uncertain, setUncertain] = useState(false);
  const runsQuery = useQuery({
    queryKey: queryKeys.workflowRuns(repositoryId, workflow?.path ?? ''),
    queryFn: () => opentig.github.listWorkflowRuns(repositoryId, workflow!.path),
    enabled: workflow !== null,
  });
  const run = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login || !workflow || !list?.defaultBranch) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.runWorkflow({ repositoryId, path: workflow.path, ref: list.defaultBranch, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      setConfirming(false);
      sileo.success({ title: 'Workflow started', description: `${workflow?.name} on ${list?.defaultBranch}. It can take a moment to appear.` });
      if (workflow) onStarted?.(workflow);
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      setConfirming(false);
      if (isUncertainFailure(reason)) {
        setUncertain(true);
        sileo.info({ title: 'No answer from GitHub yet', description: 'The workflow may have started. Check its runs before trying again.', duration: 10_000 });
      } else {
        sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      }
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, 'workflow-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, 'action-runs'] });
    },
  });
  const busy = run.isPending;
  const refreshRuns = () => {
    void runsQuery.refetch().then((result) => { if (result.isSuccess) setUncertain(false); });
  };
  const canRun = Boolean(list?.viewerCanWrite && list.defaultBranch && workflow && account?.state === 'ready' && !uncertain);
  return (
    // While the question is open, closing only withdraws it.
    <Dialog open onOpenChange={(next) => { if (!next && !busy) { if (confirming) setConfirming(false); else onClose(); } }}>
      <DialogPopup className="create-pr-dialog run-workflow-dialog">
        <div className="create-pr-content run-workflow-content">
          <DialogTitle>Run a workflow</DialogTitle>
          <DialogDescription>Runs on {list?.defaultBranch ? <code>{list.defaultBranch}</code> : 'the default branch'}, without inputs. GitHub explains when a workflow needs them or can't be started manually.</DialogDescription>
          {listQuery.isPending && <p className="pr-empty-description" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> <ShimmeringText text="Loading workflows…" /></p>}
          {listQuery.isError && <div className="pr-live-notice" role="status">Couldn't load the workflows.<Button variant="ghost" size="xs" onClick={() => void listQuery.refetch()}>Retry</Button></div>}
          {list && !list.workflows.length && <p className="pr-empty-description">This repository has no active workflows.</p>}
          {list && !list.viewerCanWrite && <p className="pr-action-note">Running workflows requires write access.</p>}
          <div className="workflow-list">
            {list?.workflows.map((item) => (
              <button key={item.id} className="workflow-row" aria-pressed={item.path === workflow?.path} disabled={busy} onClick={() => { setSelected(item); setConfirming(false); setUncertain(false); }}>
                <strong>{item.name}</strong>
                <small>{item.path}</small>
              </button>
            ))}
          </div>
          {workflow && (
            <div className="workflow-runs">
              <h4>Latest runs</h4>
              {runsQuery.isPending && <p className="pr-empty-description" role="status"><ShimmeringText text="Loading runs…" /></p>}
              {runsQuery.isError && <div className="pr-live-notice" role="status">Couldn't load the runs.<Button variant="ghost" size="xs" onClick={refreshRuns}>Retry</Button></div>}
              {runsQuery.data?.length === 0 && <p className="pr-empty-description">No runs yet.</p>}
              {runsQuery.data?.map((item) => (
                <button key={item.databaseId} className="workflow-run" disabled={!onOpenRun && !item.url} onClick={() => { if (onOpenRun) { onOpenRun(item.databaseId); onClose(); } else openOnGitHub(item.url); }}>
                  <RunIcon run={item} />
                  <span>{item.displayTitle}</span>
                  <small>{formatDateTime(item.createdAt)}</small>
                </button>
              ))}
            </div>
          )}
          {uncertain && <div className="pr-live-notice" role="status">The workflow may have started. Check its runs before trying again.<Button variant="ghost" size="xs" disabled={runsQuery.isFetching} onClick={refreshRuns}><IconRefresh /> Refresh runs</Button></div>}
        </div>
        <div className="create-pr-actions">
          {confirming && workflow
            ? <>
              <p className="run-workflow-question">Run <strong>{workflow.name}</strong> on <code>{list?.defaultBranch}</code>{account?.login ? <> as <strong>@{account.login}</strong></> : null}? It does whatever this workflow does, which can include commits, tags and publications.</p>
              <div className="create-pr-submit-actions">
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
                <Button disabled={busy} onClick={() => run.mutate()}>{busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Starting…" /></> : `Run ${workflow.name}`}</Button>
              </div>
            </>
            : <div className="create-pr-submit-actions">
              <Button variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
              <Button disabled={!canRun || busy} onClick={() => setConfirming(true)}><IconPlayerPlay /> Run workflow</Button>
            </div>}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
