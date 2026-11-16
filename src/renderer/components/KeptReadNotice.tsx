import type { QueryKey } from '@tanstack/react-query';
import { formatDateTime } from '@shared/date-format';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { TimeAgo } from '@/components/TimeAgo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useKeptRead } from '@/lib/kept-reads';
import { cn } from '@/lib/utils';

/**
 * Says that what GitHub data is on screen is an answer the server kept, not a
 * current one: while it is read again, and when that read fails. Nothing is
 * shown while everything under `prefixes` is current.
 */
export function KeptReadNotice({ prefixes, onRetry, className }: { prefixes: readonly QueryKey[]; onRetry?: () => void; className?: string }) {
  const kept = useKeptRead(prefixes);
  if (!kept) return null;
  const saved = (
    <Tooltip>
      <TooltipTrigger render={<span className="kept-read-age" tabIndex={0} />}>Saved <TimeAgo value={kept.readAt} /></TooltipTrigger>
      <TooltipContent>What GitHub said at {formatDateTime(kept.readAt)}</TooltipContent>
    </Tooltip>
  );
  return (
    <span className={cn('kept-read-notice', kept.status === 'failed' && 'kept-read-failed', className)} role="status">
      {kept.status === 'refreshing'
        ? <><Spinner className="size-3" />{saved}<span>· Updating…</span></>
        : <>{saved}<span className="kept-read-outcome">· Couldn’t update{kept.error?.message ? <>: <span className="kept-read-message">{kept.error.message}</span></> : null}</span>
          {onRetry && <Button variant="ghost" size="xs" className="kept-read-retry" onClick={onRetry}>Retry</Button>}</>}
    </span>
  );
}
