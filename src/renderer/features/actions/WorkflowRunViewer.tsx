import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { IconExternalLink, IconLoader4, IconRefresh, IconX } from '@tabler/icons-react';
import { formatDateTime } from '@shared/date-format';
import type { ActionRunDetails, ActionRunJob } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MobileActionsMenu, MobileViewerActions, MobileViewerTitle } from '@/components/MobileChrome';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { ActionStatusIcon } from './ActionStatusIcon';
import { actionStatusLabel, actionTone, elapsed, eventLabel, formatDuration, runDuration, runSentence } from './action-status';
import { WorkflowCanvas } from './WorkflowCanvas';
import './actions.css';

/** --motion-med and --ease-out. */
const PANEL_TRANSITION = { duration: 0.2, ease: [0.32, 0.72, 0, 1] as const };

/** How often a run that hasn't finished is read again. */
export const ACTIVE_RUN_REFRESH_MS = 5_000;

/** Ticks while something is running, so its durations count up. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function WorkflowRunViewer({ repositoryId, runId, jobId = null }: { repositoryId: string; runId: number; jobId?: number | null }) {
  const phone = useMobileChrome() !== null;
  const reduceMotion = useReducedMotion();
  const query = useQuery({
    queryKey: queryKeys.actionRun(repositoryId, runId),
    queryFn: () => opentig.github.getActionRun(repositoryId, runId),
    refetchInterval: (current) => current.state.data && current.state.data.status !== 'completed' ? ACTIVE_RUN_REFRESH_MS : false,
  });
  const run = query.data ?? null;
  const [selectedJobId, setSelectedJobId] = useState<number | null>(jobId);
  useEffect(() => { setSelectedJobId(jobId); }, [jobId]);
  const active = run !== null && run.status !== 'completed';
  const now = useNow(active);
  const jobs = useMemo(() => new Map((run?.jobs ?? []).map((job) => [job.id, job])), [run?.jobs]);
  const selectedJob = selectedJobId === null ? null : jobs.get(selectedJobId) ?? null;
  const title = run ? run.title : `Run ${runId}`;
  const bar = <MobileViewerTitle title={title} subtitle={run ? `${run.workflowName} #${run.number}` : undefined} />;

  if (query.isError && !run) {
    return (
      <div className="viewer-message flex-col gap-3">
        {bar}
        <p className="text-destructive">{query.error instanceof Error ? query.error.message : 'Could not load the workflow run.'}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}><IconRefresh /> Try again</Button>
      </div>
    );
  }
  if (!run) return <div className="viewer-message">{bar}<IconLoader4 className="spinner" /> <ShimmeringText text="Loading workflow run…" /></div>;

  const tone = actionTone(run.status, run.conclusion);
  const duration = runDuration(run, now);
  return (
    <div className="pr-viewer workflow-run-viewer">
      {bar}
      {phone && <MobileViewerActions>
        <MobileActionsMenu label="More run actions" title="Workflow run" items={[{ label: 'Open on GitHub', onSelect: () => openOnGitHub(run.url) }]} />
      </MobileViewerActions>}
      <header className="pr-viewer-header no-tabs">
        <div className="pr-viewer-overview">
          <div className="pr-viewer-top">
            <div className="pr-viewer-heading"><h2>{run.title}</h2></div>
            {!phone && <span className="pr-action-bar">
              {query.isFetching && <IconLoader4 className="animate-spin workflow-run-refreshing" aria-label="Refreshing" />}
              <Button variant="ghost" size="xs" onClick={() => openOnGitHub(run.url)}><IconExternalLink /> Open on GitHub</Button>
            </span>}
          </div>
          <div className="pr-viewer-status">
            <span className={`workflow-run-state action-${tone}`}><ActionStatusIcon tone={tone} /> {runSentence(run.status, run.conclusion, run.jobs)}</span>
            <span>{run.workflowName} #{run.number}{run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}</span>
            {run.branch && <span className="pr-branches">{run.branch}</span>}
            <span className="pr-branches">{run.headSha.slice(0, 7)}</span>
            <span>{eventLabel(run.event)}{run.actor ? ` by @${run.actor.login}` : ''}</span>
            <span><time dateTime={run.startedAt ?? run.createdAt}>{formatDateTime(run.startedAt ?? run.createdAt)}</time>{duration !== null ? ` · ${formatDuration(duration)}` : ''}</span>
          </div>
        </div>
      </header>
      <RunNotes run={run} />
      <div className={`workflow-run-body ${selectedJob ? 'with-job' : ''}`}>
        {run.graph.length
          ? <WorkflowCanvas graph={run.graph} jobs={jobs} runCompleted={!active} selectedJobId={selectedJobId} onSelectJob={setSelectedJobId} now={now} />
          : <div className="viewer-message">{active ? 'Waiting for the first job to start…' : 'This run has no jobs.'}</div>}
        <AnimatePresence initial={false}>
          {selectedJob && <JobPanel key="job" job={selectedJob} now={now} reduceMotion={Boolean(reduceMotion)} onClose={() => setSelectedJobId(null)} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RunNotes({ run }: { run: ActionRunDetails }) {
  const notes = [
    run.graphSource === 'jobs' && run.graph.length > 1 ? "OpenTig couldn't read this run's workflow file, so jobs are shown without their dependencies." : null,
    run.jobsTruncated ? `This run has more jobs than OpenTig shows. Open it on GitHub to see all of them.` : null,
  ].filter(Boolean);
  if (!notes.length) return null;
  return <div className="workflow-run-notes">{notes.map((note) => <p key={note}>{note}</p>)}</div>;
}

function JobPanel({ job, now, reduceMotion, onClose }: { job: ActionRunJob; now: number; reduceMotion: boolean; onClose(): void }) {
  const tone = actionTone(job.status, job.conclusion);
  const duration = elapsed(job.startedAt, job.completedAt, now);
  return (
    <motion.aside
      className="workflow-job-panel"
      aria-label={`Job ${job.name}`}
      initial={reduceMotion ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: 16 }}
      transition={PANEL_TRANSITION}
    >
      <header>
        <ActionStatusIcon tone={tone} />
        <h3>{job.name}</h3>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Close job" onClick={onClose} />}><IconX /></TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </header>
      <p className="workflow-job-facts">
        {actionStatusLabel(job.status, job.conclusion)}
        {duration !== null && ` · ${formatDuration(duration)}`}
        {job.runnerName && ` · ${job.runnerName}`}
      </p>
      {job.url && <Button variant="outline" size="xs" className="workflow-job-open" onClick={() => openOnGitHub(job.url!)}><IconExternalLink /> Logs on GitHub</Button>}
      <ol className="workflow-steps" aria-label="Steps">
        {job.steps.length === 0 && <li className="workflow-step empty">{job.status === 'completed' ? 'GitHub listed no steps.' : 'Steps appear once the job starts.'}</li>}
        {job.steps.map((step) => {
          const stepDuration = elapsed(step.startedAt, step.completedAt, now);
          const stepTone = actionTone(step.status, step.conclusion);
          return (
            <li key={step.number} className={`workflow-step tone-${stepTone}`}>
              <ActionStatusIcon tone={stepTone} />
              <span className="workflow-step-name">{step.name}</span>
              <span className="workflow-node-meta">{stepTone === 'skipped' ? 'Skipped' : stepDuration !== null ? formatDuration(stepDuration) : ''}</span>
            </li>
          );
        })}
      </ol>
    </motion.aside>
  );
}
