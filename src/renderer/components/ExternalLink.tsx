import { useContext, useId, type ComponentProps } from 'react';
import { normalizeExternalUrl } from '@shared/external-url';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RepositoryLink } from './RepositoryLink';
import { parseRepositoryLink, RepositoryLinksContext } from './repository-links';

/** A web or mail link. One into the open repository that OpenTig can show asks where to open it instead. */
export function ExternalLink({ href = '', children, title: _title, className = '', id, ...props }: ComponentProps<'a'>) {
  const tooltipId = useId();
  const links = useContext(RepositoryLinksContext);
  const url = normalizeExternalUrl(href);
  if (!url) return <>{children}</>;
  const target = links ? parseRepositoryLink(url, links.nameWithOwner) : null;
  if (target) {
    const html = props.dangerouslySetInnerHTML?.__html;
    return <RepositoryLink target={target} url={url} className={`external-text-link ${className}`} id={id} {...(typeof html === 'string' ? { html } : { children })} />;
  }
  const mail = url.startsWith('mailto:');
  return <Tooltip>
    <TooltipTrigger id={id || undefined} aria-describedby={tooltipId} render={<a {...props} className={`external-text-link ${className}`} href={url} target="_blank" rel="noopener noreferrer" />}>
      {children}
    </TooltipTrigger>
    <TooltipContent id={tooltipId} role="tooltip" side="bottom" align="start">
      <span className="shrink-0">{mail ? 'Open in mail app' : window.opentigDesktop ? 'Open in browser' : 'Open in new tab'}</span>
      <span className="truncate opacity-80">{mail ? url.slice(7) : url}</span>
    </TooltipContent>
  </Tooltip>;
}
