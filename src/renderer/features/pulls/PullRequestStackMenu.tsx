import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover } from '@base-ui/react/popover';
import { IconCheck, IconGitMerge, IconGitPullRequest, IconStack2 } from '@tabler/icons-react';
import type { PullRequestStackMembership } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

export function PullRequestStackMenu({ repositoryId, number, membership, onSelect }: {
  repositoryId: string;
  number: number;
  membership: PullRequestStackMembership;
  onSelect(number: number): void;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.pullRequestStack(repositoryId, number),
    queryFn: () => opentig.github.getPullRequestStack(repositoryId, number),
    enabled: open,
    // Reopening revalidates while keeping the last successful navigation visible.
    staleTime: 0,
  });
  const stack = query.data;
  const position = stack ? stack.layers.findIndex((layer) => layer.number === number) + 1 : membership.position;
  const size = stack?.layers.length ?? membership.size;
  const stackNumber = stack?.number ?? membership.number;
  if (query.isSuccess && stack === null && !open) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<Popover.Trigger render={<button className="pr-stack-trigger" aria-label={`Stack ${stackNumber}, layer ${position} of ${size}`} />} />}>
          <IconStack2 aria-hidden="true" /> {position}/{size}
        </TooltipTrigger>
        <TooltipContent>View stack #{stackNumber} · layer {position} of {size}</TooltipContent>
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50 outline-none">
          <Popover.Popup className="pr-stack-popup" aria-label={`Stack #${stackNumber}`}>
            <div className="pr-stack-heading"><strong>Stack #{stackNumber}</strong><Button variant="ghost" size="xs" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button></div>
            {query.isFetching && <p className="pr-stack-notice" role="status">{stack ? 'Refreshing stack…' : 'Loading stack…'}</p>}
            {query.isError && <div className="pr-stack-notice" role="status"><p>{stack ? 'Could not refresh. Showing saved layers.' : 'Could not load the stack.'}</p><Button variant="outline" size="xs" onClick={() => void query.refetch()}>Retry</Button></div>}
            {stack === null && !query.isFetching && !query.isError && <p className="pr-stack-notice">This PR is no longer in a stack, or stack data is unavailable.</p>}
            {stack && <>
              <div className="pr-stack-layers">
                {[...stack.layers].reverse().map((layer) => {
                  const state = layer.isDraft && layer.state === 'OPEN' ? 'Draft' : layer.state === 'MERGED' ? 'Merged' : layer.state === 'CLOSED' ? 'Closed' : 'Open';
                  const Icon = layer.state === 'MERGED' ? IconGitMerge : IconGitPullRequest;
                  return <Tooltip key={layer.number}>
                    <TooltipTrigger render={<button className="pr-stack-layer" aria-current={layer.number === number ? 'true' : undefined} onClick={() => { setOpen(false); onSelect(layer.number); }} />}>
                      <Icon className={`pr-stack-state ${state.toLowerCase()}`} aria-hidden="true" />
                      <span className="pr-stack-layer-text"><strong>{layer.title}</strong><small>#{layer.number} · {layer.headRefName} · {state}</small></span>
                      {layer.number === number && <IconCheck aria-hidden="true" />}
                    </TooltipTrigger>
                    <TooltipContent>{layer.title} · {layer.headRefName} · {state}</TooltipContent>
                  </Tooltip>;
                })}
              </div>
              <div className="pr-stack-base">↳ {stack.base}</div>
            </>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
