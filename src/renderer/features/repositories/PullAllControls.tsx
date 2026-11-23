import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { IconArrowDown, IconCheck, IconClock, IconMinus, IconX } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { pullAllButtonCopy, pullAllProgress, type PullAllRowState, type PullAllRun } from './pull-all';

// Controls inside the list's popup keep the focus in the search and don't pick a row.
const keepFocus = (event: PointerEvent) => { event.preventDefault(); event.stopPropagation(); };
const ownKeys = (event: KeyboardEvent) => event.stopPropagation();

/**
 * Pull all, at the end of the repository list's search: a button with how many rows it would
 * pull, or, while a run goes, its progress and Stop.
 */
export function PullAllControl({ run, count, searching, leftOut, onPull, onStop }: {
  run: PullAllRun | null;
  count: number;
  searching: boolean;
  /** Rows on screen with something to pull that their own Pull has to bring in. */
  leftOut: readonly string[];
  onPull(): void;
  onStop(): void;
}) {
  const stop = useRef<HTMLButtonElement>(null);
  const focusStop = useRef(false);
  const running = Boolean(run && !run.finished);
  // The button that started the run gives way to Stop, which takes the focus it had.
  useEffect(() => {
    if (running && focusStop.current) stop.current?.focus();
    focusStop.current = false;
  }, [running]);

  if (run && running) {
    const { done, total } = pullAllProgress(run);
    return (
      <span className="pull-all-control">
        <span className="pull-all-progress" role="status"><Spinner />{done} of {total} done</span>
        <Button ref={stop} type="button" variant="ghost" size="xs" className="pull-all-stop" disabled={run.stopped}
          onPointerDown={keepFocus} onKeyDown={ownKeys} onClick={(event) => { event.preventDefault(); onStop(); }}>
          Stop
        </Button>
      </span>
    );
  }
  if (count === 0) return null;
  const copy = pullAllButtonCopy(count, searching, leftOut);
  return (
    <Tooltip>
      <TooltipTrigger render={(
        <Button type="button" variant="ghost" size="xs" data-sync="pull" className="pull-all-button" aria-label={copy.ariaLabel}
          onPointerDown={keepFocus} onKeyDown={ownKeys}
          onClick={(event) => { event.preventDefault(); focusStop.current = document.activeElement === event.currentTarget; onPull(); }} />
      )}>
        <IconArrowDown data-icon="inline-start" />
        <span>{copy.label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{copy.tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** Where a row stands in a Pull all run, at its right; a running row shows its own Pull spinning instead. */
export function PullAllRowChip({ state }: { state: PullAllRowState | undefined }) {
  switch (state?.phase) {
    case 'queued': return <span className="pull-all-chip" data-tone="queued"><IconClock aria-hidden="true" />Queued</span>;
    case 'pulled':
    case 'up-to-date': return <span className="pull-all-chip pull-all-chip-icon" data-tone="success" role="img" aria-label="Pulled"><IconCheck aria-hidden="true" /></span>;
    case 'skipped': return <span className="pull-all-chip pull-all-chip-icon" data-tone="warning" role="img" aria-label="Skipped"><IconMinus aria-hidden="true" /></span>;
    case 'failed': return <span className="pull-all-chip pull-all-chip-icon" data-tone="error" role="img" aria-label="Failed"><IconX aria-hidden="true" /></span>;
    case 'not-pulled': return <span className="pull-all-chip" data-tone="off">Not pulled</span>;
    default: return null;
  }
}
