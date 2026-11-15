import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowDown, IconArrowLeft, IconArrowUp, IconChevronRight, IconClock, IconCopy, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { ACTION_JOB_LOG_LIMITS, type ActionJobLog, type ActionJobLogLine, type ActionRunJob } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { withSignal } from '@/lib/websocket-transport';
import { openOnGitHub } from '@/features/pulls/gh-utils';
import { ActionStatusIcon } from './ActionStatusIcon';
import { actionStatusLabel, actionTone, elapsed, formatDuration } from './action-status';
import { parseAnsi } from './ansi';
import { initialLogView, logRows, outlineLog, stepText, type LogOutline, type LogRow } from './job-log-rows';
import './job-log.css';

/** A job's log is large and may hold what a workflow printed: once off screen it goes after a minute, not the half hour other GitHub answers stay. */
const JOB_LOG_GC_MS = 60_000;

type ReadyLog = Extract<ActionJobLog, { state: 'ready' }>;

function jobLogQueryOptions(repositoryId: string, jobId: number, enabled: boolean) {
  return {
    queryKey: queryKeys.actionJobLog(repositoryId, jobId),
    queryFn: ({ signal }: { signal: AbortSignal }) => withSignal(signal, () => opentig.github.getActionJobLog(repositoryId, jobId)),
    enabled,
    // A finished job's log doesn't change; running the job again makes another job.
    staleTime: Infinity,
    gcTime: JOB_LOG_GC_MS,
  };
}

/**
 * A job's log inside the run viewer, by step. It opens on why the job failed: the
 * failed step unfolded at its first error, or at its last line. Only the rows near
 * the screen are drawn, and the text is always shown as text.
 */
export function JobLogView({ repositoryId, job, initialStep = null, now, onBack }: {
  repositoryId: string;
  job: ActionRunJob;
  /** The step chosen to open the log on, by GitHub's number. */
  initialStep?: number | null;
  now: number;
  onBack(): void;
}) {
  const finished = job.status === 'completed';
  const query = useQuery(jobLogQueryOptions(repositoryId, job.id, finished));
  const tone = actionTone(job.status, job.conclusion);
  const duration = elapsed(job.startedAt, job.completedAt, now);
  const log = query.data;
  const openJob = job.url ? () => openOnGitHub(job.url!) : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [role="menu"], input, textarea')) return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  let body: ReactNode;
  if (!finished) {
    body = <LogMessage>
      <p>This job is {job.status === 'in_progress' ? 'still running' : 'waiting to run'}. GitHub serves a job's log once the job has finished, and it shows here then.</p>
      {openJob && <Button variant="outline" size="sm" onClick={openJob}><IconExternalLink /> Follow it on GitHub</Button>}
    </LogMessage>;
  } else if (query.isError) {
    body = <LogMessage>
      <p className="text-destructive">{query.error instanceof Error ? query.error.message : "Could not read the job's log."}</p>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()}><IconRefresh /> Try again</Button>
    </LogMessage>;
  } else if (!log) {
    body = <div className="viewer-message" role="status"><Spinner className="view-spinner" /> <ShimmeringText text="Reading the log…" /></div>;
  } else if (log.state === 'pending') {
    body = <LogMessage>
      <p>GitHub doesn't serve this job's log yet. It usually does a few seconds after the job finishes.</p>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()}><IconRefresh /> Try again</Button>
    </LogMessage>;
  } else if (log.state === 'unavailable') {
    body = <LogMessage>
      <p>{log.reason === 'not-run' ? "This job didn't run, so it has no log." : 'GitHub no longer has this log. Logs are deleted after the repository’s retention period.'}</p>
    </LogMessage>;
  } else {
    body = <ReadyJobLog key={log.jobId} log={log} job={job} initialStep={initialStep} onOpenJob={openJob} />;
  }

  return (
    <section className="job-log" aria-label={`Log of ${job.name}`}>
      <header className="job-log-header">
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Back to the run" onClick={onBack} />}><IconArrowLeft /></TooltipTrigger>
          <TooltipContent>Back to the run (Esc)</TooltipContent>
        </Tooltip>
        <ActionStatusIcon tone={tone} />
        <div className="job-log-title">
          <h3>{job.name}</h3>
          <p>{actionStatusLabel(job.status, job.conclusion)}{duration !== null ? ` · ${formatDuration(duration)}` : ''}</p>
        </div>
        {openJob && <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open this job on GitHub" onClick={openJob} />}><IconExternalLink /></TooltipTrigger>
          <TooltipContent>Open on GitHub</TooltipContent>
        </Tooltip>}
      </header>
      {body}
    </section>
  );
}

function LogMessage({ children }: { children: ReactNode }) {
  return <div className="viewer-message job-log-message flex-col gap-3 text-center">{children}</div>;
}

function ReadyJobLog({ log, job, initialStep, onOpenJob }: { log: ReadyLog; job: ActionRunJob; initialStep: number | null; onOpenJob: (() => void) | null }) {
  const outline = useMemo(() => outlineLog(log), [log]);
  const initial = useMemo(() => initialLogView(log, outline, initialStep), [initialStep, log, outline]);
  const [openSteps, setOpenSteps] = useState(() => initial.steps);
  const [openGroups, setOpenGroups] = useState(() => initial.groups);
  const [showTimes, setShowTimes] = useState(false);
  const [target, setTarget] = useState<{ step: number; line: number | null } | null>(initial.target);
  const [errorIndex, setErrorIndex] = useState<number>(() => initial.target?.line == null ? -1 : outline.errors.findIndex((error) => error.step === initial.target!.step && error.line === initial.target!.line));
  const rows = useMemo(() => logRows(log, outline, openSteps, openGroups), [log, outline, openGroups, openSteps]);
  // Wide enough for the longest line number, so numbers line up and never crowd the text.
  const numberDigits = useMemo(() => String(Math.max(1, ...log.steps.map((step) => step.lines.at(-1)?.number ?? 0))).length, [log]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.type === 'step' ? 36 : 20,
    getItemKey: (index) => rows[index]!.key,
    overscan: 24,
  });

  // Once the rows the target needs are drawn, it is brought to the middle of the view.
  useEffect(() => {
    if (!target) return;
    const index = rows.findIndex((row) => row.step === target.step && (target.line === null ? row.type === 'step' : (row.type === 'line' || row.type === 'group') && row.line === target.line));
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: target.line === null ? 'start' : 'center' });
  }, [rows, target, virtualizer]);

  const toggleStep = useCallback((step: number) => {
    setTarget(null);
    setOpenSteps((current) => { const next = new Set(current); if (next.has(step)) next.delete(step); else next.add(step); return next; });
  }, []);
  const toggleGroup = useCallback((key: string) => {
    setTarget(null);
    setOpenGroups((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }, []);
  const goToError = (index: number) => {
    const error = outline.errors[index];
    if (!error) return;
    setErrorIndex(index);
    setOpenSteps((current) => current.has(error.step) ? current : new Set([...current, error.step]));
    if (error.group) setOpenGroups((current) => current.has(error.group!) ? current : new Set([...current, error.group!]));
    setTarget({ step: error.step, line: error.line });
  };
  const errorCount = outline.errors.length;
  const current = errorIndex >= 0 && errorIndex < errorCount ? errorIndex : -1;
  const highlighted = target?.line != null ? `${target.step}:${target.line}` : null;

  return (
    <>
      <div className="job-log-tools">
        {errorCount > 0 ? <span className="job-log-errors" role="group" aria-label="Errors">
          <span className="job-log-error-count" aria-live="polite">{current >= 0 ? `Error ${current + 1} of ${errorCount}` : `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`}</span>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Previous error" onClick={() => goToError(current <= 0 ? errorCount - 1 : current - 1)} />}><IconArrowUp /></TooltipTrigger>
            <TooltipContent>Previous error</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Next error" onClick={() => goToError(current < 0 || current >= errorCount - 1 ? 0 : current + 1)} />}><IconArrowDown /></TooltipTrigger>
            <TooltipContent>Next error</TooltipContent>
          </Tooltip>
        </span> : <span className="job-log-error-count">No errors marked by GitHub</span>}
        <Tooltip>
          <TooltipTrigger render={<Button variant={showTimes ? 'secondary' : 'ghost'} size="icon-xs" aria-label="Show times" aria-pressed={showTimes} onClick={() => setShowTimes((value) => !value)} />}><IconClock /></TooltipTrigger>
          <TooltipContent>{showTimes ? 'Hide times' : 'Show when each line was written'}</TooltipContent>
        </Tooltip>
      </div>
      {(log.readCut || log.displayCut) && <div className="job-log-notice" role="note">
        <p>{log.readCut
          ? `This log is larger than ${formatMegabytes(ACTION_JOB_LOG_LIMITS.readBytes)}. OpenTig read only its start, so later steps may show nothing here.`
          : `This log is long. OpenTig shows up to ${ACTION_JOB_LOG_LIMITS.lines.toLocaleString()} of its lines, the end of each step and most of a failed one, and cuts lines longer than ${ACTION_JOB_LOG_LIMITS.lineCharacters.toLocaleString()} characters. What is left out is marked.`}</p>
        {onOpenJob && <Button variant="outline" size="xs" onClick={onOpenJob}><IconExternalLink /> Full log on GitHub</Button>}
      </div>}
      <div ref={scrollRef} className={`job-log-body${showTimes ? ' with-times' : ''}`} style={{ '--job-log-number': `${numberDigits}ch` } as CSSProperties} tabIndex={0} role="region" aria-label={`Log of ${job.name}, by step`}>
        <div className="virtual-list" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return (
              <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} className="virtual-row" style={{ transform: `translateY(${item.start}px)` }}>
                <LogRowView row={row} log={log} outline={outline} openSteps={openSteps} highlighted={highlighted} onToggleStep={toggleStep} onToggleGroup={toggleGroup} onOpenJob={onOpenJob} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const LogRowView = memo(function LogRowView({ row, log, outline, openSteps, highlighted, onToggleStep, onToggleGroup, onOpenJob }: {
  row: LogRow; log: ReadyLog; outline: LogOutline; openSteps: ReadonlySet<number>; highlighted: string | null;
  onToggleStep(step: number): void; onToggleGroup(key: string): void; onOpenJob: (() => void) | null;
}) {
  const step = log.steps[row.step]!;
  if (row.type === 'step') {
    const tone = actionTone(step.status, step.conclusion);
    const open = openSteps.has(row.step);
    const errors = outline.errorCounts[row.step]!;
    const warnings = outline.warningCounts[row.step]!;
    const skipped = tone === 'skipped';
    return (
      <div className={`job-log-step tone-${tone}`}>
        <button type="button" className="job-log-step-toggle" aria-expanded={skipped ? undefined : open} disabled={skipped} onClick={() => onToggleStep(row.step)}>
          <IconChevronRight className={`folder-chevron ${open ? 'open' : ''}`} aria-hidden="true" />
          <ActionStatusIcon tone={tone} />
          <span className="job-log-step-name">{step.name}</span>
          {skipped && <span className="job-log-step-meta">Skipped</span>}
          {errors > 0 && <span className="job-log-badge error">{errors} {errors === 1 ? 'error' : 'errors'}</span>}
          {warnings > 0 && <span className="job-log-badge warning">{warnings} {warnings === 1 ? 'warning' : 'warnings'}</span>}
        </button>
        {step.lines.length > 0 && <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="job-log-copy" aria-label={`Copy the log of ${step.name}`} onClick={() => void copyStep(step.name, stepText(step), step.omittedLines)} />}><IconCopy /></TooltipTrigger>
          <TooltipContent>Copy this step’s log</TooltipContent>
        </Tooltip>}
      </div>
    );
  }
  if (row.type === 'omitted') {
    return (
      <div className="job-log-omitted">
        <span>{row.count.toLocaleString()} earlier {row.count === 1 ? 'line' : 'lines'} of this step left out.</span>
        {onOpenJob && <button type="button" className="job-log-link" onClick={onOpenJob}>See them on GitHub</button>}
      </div>
    );
  }
  if (row.type === 'empty') {
    return <div className="job-log-empty">{log.readCut ? 'Not in the part of the log OpenTig read.' : 'No lines of the log were matched to this step.'}</div>;
  }
  const line = step.lines[row.line]!;
  const current = highlighted === `${row.step}:${row.line}`;
  if (row.type === 'group') {
    const hidden = row.group.end - row.group.start - 1;
    return (
      <div className={`job-log-line kind-group${current ? ' current' : ''}`}>
        <LineGutter line={line} />
        <button type="button" className="job-log-group" aria-expanded={row.open} onClick={() => onToggleGroup(row.group.key)}>
          <IconChevronRight className={`folder-chevron ${row.open ? 'open' : ''}`} aria-hidden="true" />
          <AnsiText text={line.text} />
          {!row.open && hidden > 0 && <span className="job-log-group-count">{hidden} {hidden === 1 ? 'line' : 'lines'}{row.group.errors > 0 ? `, ${row.group.errors} ${row.group.errors === 1 ? 'error' : 'errors'}` : ''}</span>}
        </button>
      </div>
    );
  }
  return (
    <div className={`job-log-line kind-${line.kind}${row.grouped ? ' grouped' : ''}${current ? ' current' : ''}`}>
      <LineGutter line={line} />
      <span className="job-log-text">
        {line.kind === 'error' && <span className="job-log-kind">Error: </span>}
        {line.kind === 'warning' && <span className="job-log-kind">Warning: </span>}
        {line.kind === 'notice' && <span className="job-log-kind">Notice: </span>}
        <AnsiText text={line.text} />
        {line.clipped && <span className="job-log-clipped"> … line cut</span>}
      </span>
    </div>
  );
});

function LineGutter({ line }: { line: ActionJobLogLine }) {
  return <>
    <span className="job-log-number" aria-hidden="true">{line.number}</span>
    <span className="job-log-time" aria-hidden="true">{line.time === null ? '' : formatTime(line.time)}</span>
  </>;
}

/** Colors as classes of the theme's terminal palette; the text itself is a text node. */
function AnsiText({ text }: { text: string }) {
  const segments = useMemo(() => parseAnsi(text), [text]);
  return <>{segments.map((segment, index) => {
    const classes = [
      segment.fg !== null && `ansi-fg-${segment.fg}`,
      segment.bg !== null && `ansi-bg-${segment.bg}`,
      segment.bold && 'ansi-bold', segment.dim && 'ansi-dim', segment.italic && 'ansi-italic', segment.underline && 'ansi-underline',
    ].filter(Boolean).join(' ');
    return classes ? <span key={index} className={classes}>{segment.text}</span> : segment.text;
  })}</>;
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function formatTime(time: number): string {
  return TIME_FORMAT.format(time);
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

async function copyStep(name: string, text: string, omitted: number): Promise<void> {
  try {
    await writeClipboardText(text);
    sileo.success({ title: 'Step log copied', description: omitted > 0 ? `${name}, without the ${omitted.toLocaleString()} earlier lines OpenTig left out.` : name });
  } catch {
    sileo.error({ title: 'Could not copy the step log' });
  }
}
