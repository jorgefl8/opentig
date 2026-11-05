import { useMemo, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconChevronRight, IconGitBranch, IconLoader4, IconPlayerPlay, IconRefresh, IconSearch } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { formatTimeAgo } from '@shared/date-format';
import type { ActionRunSummary, RunnableWorkflow, WorkflowInput, WorkflowTriggers } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { SearchablePicker } from '@/components/SearchablePicker';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ContentFade, Reveal } from '@/components/Reveal';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ConfirmPopover } from '@/features/pulls/ConfirmPopover';
import { ghDetail, ghErrorTitle, isUncertainFailure } from '@/features/pulls/gh-utils';
import { useGitHubAccount } from '@/features/pulls/useGitHubAccount';
import { ActionStatusIcon } from './ActionStatusIcon';
import { latestActionRunsOptions } from './action-queries';
import { actionStatusLabel, actionTone, eventLabel, formatDuration, runDuration } from './action-status';
import './actions.css';

/** Runs a workflow can't be started by hand unless its file says so; one OpenTig couldn't read is offered anyway. */
function canRunManually(workflow: RunnableWorkflow): boolean {
  return workflow.triggers === null || workflow.triggers.inputs !== null;
}

/** What an input starts as: its default, or off for a switch. */
function initialValue(input: WorkflowInput): string {
  return input.default ?? (input.type === 'boolean' ? 'false' : input.type === 'choice' ? input.options[0] ?? '' : '');
}

function isMissing(input: WorkflowInput, value: string): boolean {
  return input.required && input.type !== 'boolean' && value.trim() === '';
}

export function RunWorkflowDialog({ repositoryId, initialWorkflowId = null, onOpenRun, onStarted, onClose }: {
  repositoryId: string;
  /** The workflow to start with, such as the one the list is filtered by. */
  initialWorkflowId?: number | null;
  onOpenRun(runId: number): void;
  /** GitHub accepted the request; its run appears a few seconds later. */
  onStarted(workflow: RunnableWorkflow): void;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const listQuery = useQuery({ queryKey: queryKeys.runnableWorkflows(repositoryId), queryFn: () => opentig.github.listRunnableWorkflows(repositoryId) });
  const list = listQuery.data;
  const recent = useQuery(latestActionRunsOptions(repositoryId, null));
  const [search, setSearch] = useState('');
  const [showAutomatic, setShowAutomatic] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(initialWorkflowId);
  const [branchChoice, setBranchChoice] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<HTMLElement | null>(null);
  // A run with no answer may have started. Repeating it could start it twice, so its runs come first.
  const [uncertain, setUncertain] = useState(false);

  const sorted = useMemo(() => [...(list?.workflows ?? [])].sort((left, right) => left.name.localeCompare(right.name)), [list?.workflows]);
  const query = search.trim().toLocaleLowerCase();
  const matches = (workflow: RunnableWorkflow) => !query || `${workflow.name} ${workflow.path}`.toLocaleLowerCase().includes(query);
  const manual = sorted.filter((workflow) => canRunManually(workflow) && matches(workflow));
  const automatic = sorted.filter((workflow) => !canRunManually(workflow) && matches(workflow));
  const workflow = manual.find((item) => item.id === selectedId) ?? manual[0] ?? null;
  const branch = branchChoice ?? list?.defaultBranch ?? null;
  const onDefaultBranch = branch !== null && branch === list?.defaultBranch;
  // The file on another branch can ask for other inputs, or not allow a manual run at all.
  const branchTriggers = useQuery({
    queryKey: queryKeys.workflowTriggers(repositoryId, workflow?.path ?? '', branch ?? ''),
    queryFn: () => opentig.github.getWorkflowTriggers(repositoryId, workflow!.path, branch!),
    enabled: Boolean(workflow && branch && !onDefaultBranch),
  });
  const triggers: WorkflowTriggers | null | undefined = onDefaultBranch ? workflow?.triggers : branchTriggers.data;
  const inputs = triggers?.inputs ?? [];
  const valueOf = (input: WorkflowInput) => values[`${workflow?.path}:${input.name}`] ?? initialValue(input);
  const setValue = (input: WorkflowInput, value: string) => setValues((current) => ({ ...current, [`${workflow?.path}:${input.name}`]: value }));
  const runs = useQuery({ ...latestActionRunsOptions(repositoryId, workflow?.id ?? null), enabled: workflow !== null });

  const lastRuns = useMemo(() => {
    const byWorkflow = new Map<number, ActionRunSummary[]>();
    for (const run of recent.data ?? []) byWorkflow.set(run.workflowId, [...(byWorkflow.get(run.workflowId) ?? []), run]);
    return byWorkflow;
  }, [recent.data]);

  const run = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login || !workflow || !branch) throw new Error('Check the GitHub account in Settings and try again.');
      const fields = Object.fromEntries(inputs.map((input) => [input.name, valueOf(input)]).filter(([, value]) => value !== ''));
      return opentig.github.runWorkflow({ repositoryId, path: workflow.path, ref: branch, inputs: fields, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      setConfirming(null);
      sileo.success({ title: 'Workflow started', description: `${workflow?.name} on ${branch}. It opens as soon as GitHub lists it.` });
      if (workflow) onStarted(workflow);
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      setConfirming(null);
      if (isUncertainFailure(reason)) {
        setUncertain(true);
        sileo.info({ title: 'No answer from GitHub yet', description: 'The workflow may have started. Check its runs before trying again.', duration: 10_000 });
      } else {
        sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      }
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, 'action-runs'] }); },
  });
  const busy = run.isPending;
  const refreshRuns = () => {
    void runs.refetch().then((result) => { if (result.isSuccess) setUncertain(false); });
  };

  const missing = inputs.filter((input) => isMissing(input, valueOf(input)));
  const blocked = !list ? 'Loading workflows…'
    : !list.viewerCanWrite ? 'Running workflows requires write access.'
      : account?.state !== 'ready' || !account.login ? 'Check the GitHub account in Settings.'
        : !workflow ? 'Choose a workflow.'
          : !branch ? 'Choose a branch.'
            : !onDefaultBranch && branchTriggers.isPending ? `Reading the workflow on ${branch}…`
              : triggers && triggers.inputs === null ? `On ${branch}, this workflow can't be run manually.`
                : uncertain ? 'Refresh its runs first: the last request may have started it.'
                  : missing.length ? `Fill in ${missing.map((input) => input.name).join(', ')}.`
                    : null;

  const choose = (id: number) => {
    if (busy) return;
    setSelectedId(id);
    setConfirming(null);
    setUncertain(false);
  };
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = manual.findIndex((item) => item.id === workflow?.id);
    const next = manual[Math.min(manual.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    choose(next.id);
    event.currentTarget.querySelector<HTMLElement>(`[data-workflow-id="${next.id}"]`)?.focus();
  };

  return (
    // While the question is open, closing only withdraws it.
    <Dialog open onOpenChange={(next) => { if (!next && !busy) { if (confirming) setConfirming(null); else onClose(); } }}>
      <DialogPopup className="run-workflow-dialog">
        <header className="run-workflow-head">
          <DialogTitle>Run a workflow</DialogTitle>
          <DialogDescription className="sr-only">Choose a workflow that can run manually, its branch and inputs, then run it.</DialogDescription>
        </header>
        <div className="run-workflow-body">
          <nav className="run-workflow-list" aria-label="Workflows">
            <label className="run-workflow-search">
              <IconSearch aria-hidden="true" />
              <input value={search} placeholder="Search" aria-label="Search workflows" spellCheck={false} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {listQuery.isPending && <p className="run-workflow-note" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> <ShimmeringText text="Loading workflows…" /></p>}
            {listQuery.isError && <div className="run-workflow-note" role="status">Couldn't load the workflows.<Button variant="ghost" size="xs" onClick={() => void listQuery.refetch()}>Retry</Button></div>}
            {list && (
              <>
                <h4 className="run-workflow-group">Run manually</h4>
                <div role="listbox" className="run-workflow-options" aria-label="Workflows that can run manually" onKeyDown={onListKeyDown}>
                  {manual.map((item) => {
                    const latest = lastRuns.get(item.id) ?? [];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        data-workflow-id={item.id}
                        aria-selected={item.id === workflow?.id}
                        tabIndex={item.id === workflow?.id ? 0 : -1}
                        className="run-workflow-option"
                        onClick={() => choose(item.id)}
                      >
                        <span className="run-workflow-option-name">{item.name}</span>
                        {latest.length > 0 && (
                          <span className="run-workflow-dots" aria-hidden="true">
                            {latest.slice(0, 5).map((runItem) => <i key={runItem.id} className={`action-${actionTone(runItem.status, runItem.conclusion)}`} />)}
                          </span>
                        )}
                        {latest[0] && <span className="sr-only">, last run {actionStatusLabel(latest[0].status, latest[0].conclusion)}</span>}
                      </button>
                    );
                  })}
                  {manual.length === 0 && <p className="run-workflow-note">{query ? 'No workflow matches.' : 'No workflow here can be run manually.'}</p>}
                </div>
                {automatic.length > 0 && (
                  <>
                    <button type="button" className="run-workflow-more" aria-expanded={showAutomatic} onClick={() => setShowAutomatic((value) => !value)}>
                      <IconChevronRight className={showAutomatic ? 'open' : ''} aria-hidden="true" /> {automatic.length} automatic
                    </button>
                    <Reveal open={showAutomatic}>
                      <ul className="run-workflow-automatic" aria-label="Workflows that only run automatically">
                        {automatic.map((item) => (
                          <li key={item.id}>
                            <span className="run-workflow-option-name">{item.name}</span>
                            {item.triggers?.events[0] && <span className="run-workflow-event">{eventLabel(item.triggers.events[0])}</span>}
                          </li>
                        ))}
                      </ul>
                    </Reveal>
                  </>
                )}
              </>
            )}
          </nav>
          <section className="run-workflow-detail" aria-label={workflow ? workflow.name : 'Workflow'}>
            {workflow && list && (
              <ContentFade key={workflow.id} className="run-workflow-detail-content">
                <div className="run-workflow-title">
                  <h3>{workflow.name}</h3>
                  <code>{workflow.path.split('/').pop()}</code>
                </div>
                {workflow.triggers === null && <p className="run-workflow-note">OpenTig couldn't read this workflow's file, so it can't list its inputs. GitHub says if it needs any or can't be started manually.</p>}
                <div className="run-workflow-field">
                  <label htmlFor="run-workflow-branch">Branch</label>
                  {/* The same searchable picker as the top bar's branch selector, with the branches on GitHub. */}
                  <SearchablePicker
                    groups={[{ id: 'branches', label: 'Branches on GitHub', items: list.branches.map((name) => ({
                      value: name,
                      label: name,
                      icon: <IconGitBranch />,
                      ...(name === list.defaultBranch ? { trailing: <span className="searchable-picker-status">Default</span> } : {}),
                    })) }]}
                    value={branch ?? ''}
                    onValueChange={(value) => { setBranchChoice(value); setConfirming(null); }}
                    label="Select branch"
                    triggerId="run-workflow-branch"
                    triggerLabel={branch ?? 'Choose a branch'}
                    icon={<IconGitBranch />}
                    size="default"
                    triggerClassName="run-workflow-branch"
                    align="start"
                    placeholder="Search branches…"
                    disabled={busy}
                  />
                  <small>Uses the workflow file on this branch.</small>
                </div>
                {!onDefaultBranch && branchTriggers.isPending && <p className="run-workflow-note" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> <ShimmeringText text={`Reading the workflow on ${branch}…`} /></p>}
                {inputs.map((input) => <InputField key={`${workflow.path}:${branch}:${input.name}`} input={input} value={valueOf(input)} disabled={busy} onChange={(value) => setValue(input, value)} />)}
                <h4 className="run-workflow-section">Latest runs</h4>
                <RecentRuns runs={runs.data} loading={runs.isPending} failed={runs.isError} onRetry={refreshRuns} onOpen={(id) => { onOpenRun(id); onClose(); }} />
                <Reveal open={uncertain}>
                  <div className="run-workflow-note run-workflow-uncertain" role="status">
                    The workflow may have started. Check its runs before trying again.
                    <Button variant="ghost" size="xs" disabled={runs.isFetching} onClick={refreshRuns}><IconRefresh /> Refresh runs</Button>
                  </div>
                </Reveal>
              </ContentFade>
            )}
          </section>
        </div>
        <footer className="run-workflow-foot">
          <span className="run-workflow-as">{account?.login ? <>as <strong>@{account.login}</strong></> : null}</span>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Tooltip>
            <TooltipTrigger render={<Button disabled={Boolean(blocked) || busy} focusableWhenDisabled onClick={(event) => setConfirming(event.currentTarget)} />}>
              <IconPlayerPlay /> Run workflow
            </TooltipTrigger>
            {blocked && <TooltipContent>{blocked}</TooltipContent>}
          </Tooltip>
        </footer>
        {confirming && workflow && branch && <ConfirmPopover
          anchor={confirming}
          label="Confirm the run"
          title={`Run ${workflow.name}`}
          footnote={account?.login ? `as @${account.login}` : undefined}
          busy={busy}
          onCancel={() => setConfirming(null)}
          confirm={<Button size="xs" disabled={busy} onClick={() => run.mutate()}>{busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Starting…" /></> : `Run ${workflow.name}`}</Button>}
        >
          <p>Run <strong>{workflow.name}</strong> on <code>{branch}</code>? It does whatever this workflow does, which can include commits, tags and publications.</p>
          {inputs.length > 0 && (
            <dl className="release-publish-facts">
              {inputs.map((input) => <div key={input.name}><dt>{input.name}</dt><dd>{valueOf(input) === '' ? <em>empty</em> : <code>{valueOf(input)}</code>}</dd></div>)}
            </dl>
          )}
        </ConfirmPopover>}
      </DialogPopup>
    </Dialog>
  );
}

function InputField({ input, value, disabled, onChange }: { input: WorkflowInput; value: string; disabled: boolean; onChange(value: string): void }) {
  const id = `run-workflow-input-${input.name}`;
  const help = input.description && <small id={`${id}-help`}>{input.description}</small>;
  if (input.type === 'boolean') {
    return (
      <div className="run-workflow-field run-workflow-check">
        <label htmlFor={id}><Checkbox id={id} checked={value === 'true'} disabled={disabled} onCheckedChange={(checked) => onChange(checked === true ? 'true' : 'false')} /> {input.name}</label>
        {help}
      </div>
    );
  }
  return (
    <div className="run-workflow-field">
      <label htmlFor={id}>{input.name}{input.required && <span className="run-workflow-required" aria-label="required"> *</span>}</label>
      {input.type === 'choice'
        ? <Select value={value} onValueChange={(next) => { if (next !== null) onChange(String(next)); }} disabled={disabled}>
          <SelectTrigger id={id} className="run-workflow-select" aria-describedby={input.description ? `${id}-help` : undefined}><SelectValue>{value}</SelectValue></SelectTrigger>
          <SelectContent alignItemWithTrigger={false} className="run-workflow-select-menu">
            {input.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
          </SelectContent>
        </Select>
        : <input
          id={id}
          className="field-input"
          type={input.type === 'number' ? 'number' : 'text'}
          value={value}
          required={input.required}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={isMissing(input, value) || undefined}
          aria-describedby={input.description ? `${id}-help` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />}
      {help}
    </div>
  );
}

function RecentRuns({ runs, loading, failed, onRetry, onOpen }: { runs: ActionRunSummary[] | undefined; loading: boolean; failed: boolean; onRetry(): void; onOpen(runId: number): void }) {
  if (loading) return <p className="run-workflow-note" role="status"><ShimmeringText text="Loading runs…" /></p>;
  if (failed) return <div className="run-workflow-note" role="status">Couldn't load the runs.<Button variant="ghost" size="xs" onClick={onRetry}>Retry</Button></div>;
  if (!runs?.length) return <p className="run-workflow-note">No runs yet.</p>;
  return (
    <div className="run-workflow-runs">
      {runs.slice(0, 3).map((item) => {
        const duration = runDuration(item, Date.parse(item.updatedAt));
        return (
          <button key={item.id} type="button" className="run-workflow-run" onClick={() => onOpen(item.id)}>
            <ActionStatusIcon tone={actionTone(item.status, item.conclusion)} />
            <span className="run-workflow-run-title">{item.title || `Run ${item.number}`}</span>
            <span className="run-workflow-run-meta">#{item.number}{item.branch ? ` · ${item.branch}` : ''} · {formatTimeAgo(item.createdAt)}{item.status === 'completed' && duration !== null ? ` · ${formatDuration(duration)}` : ` · ${actionStatusLabel(item.status, item.conclusion)}`}</span>
          </button>
        );
      })}
    </div>
  );
}
