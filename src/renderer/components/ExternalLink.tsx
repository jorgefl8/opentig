import { useId, type ComponentProps } from 'react';
import { normalizeExternalUrl } from '@shared/external-url';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ExternalLink({ href = '', children, title: _title, className = '', id, ...props }: ComponentProps<'a'>) {
  const tooltipId = useId();
  const url = normalizeExternalUrl(href);
  if (!url) return <>{children}</>;
  const mail = url.startsWith('mailto:');
  return <Tooltip>
    <TooltipTrigger id={id || undefined} aria-describedby={tooltipId} render={<a {...props} className={`external-text-link ${className}`} href={url} target="_blank" rel="noopener noreferrer" />}>
      {children}
    </TooltipTrigger>
    <TooltipContent id={tooltipId} role="tooltip" side="bottom" align="start">
      <span className="shrink-0">{mail ? 'Open in mail app' : 'Open in new tab'}</span>
      <span className="truncate opacity-80">{mail ? url.slice(7) : url}</span>
    </TooltipContent>
  </Tooltip>;
}
