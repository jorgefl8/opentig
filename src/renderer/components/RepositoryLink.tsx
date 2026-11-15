import { useContext, type ReactNode } from 'react';
import { IconExternalLink } from '@tabler/icons-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openExternalUrl } from '@/lib/browser-capabilities';
import { RepositoryLinksContext, repositoryLinkLabel, repositoryLinkUrl, type RepositoryLinkTarget } from './repository-links';

/**
 * A reference to something OpenTig can open: a click opens it here, and the
 * small icon after it opens it on GitHub. Without a GitHub repository open,
 * it's whatever `fallback` is.
 */
export function RepositoryLink({ target, url, className, id, label, note, fallback, children, html }: {
  target: RepositoryLinkTarget;
  /** The link as written; otherwise the canonical one is built. */
  url?: string;
  className?: string;
  id?: string | undefined;
  label?: string;
  /** More about the reference, such as what it may turn out to be, shown when the pointer rests on it. */
  note?: string;
  fallback?: ReactNode;
  children?: ReactNode;
  /** Sanitized Markdown content, from LinkedMarkdown. */
  html?: string;
}) {
  const links = useContext(RepositoryLinksContext);
  if (!links) return <>{fallback ?? children}</>;
  const title = repositoryLinkLabel(target);
  const href = url ?? repositoryLinkUrl(links.nameWithOwner, target);
  const named = `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  const link = (
    <button
      type="button"
      id={id || undefined}
      className={`repository-link ${className ?? ''}`}
      aria-label={label}
      onClick={() => links.open(target)}
      {...(html === undefined ? { children } : { dangerouslySetInnerHTML: { __html: html } })}
    />
  );
  // A clickable row or entry around the link must not act on its clicks too.
  return <span className="repository-link-pair" onClick={(event) => event.stopPropagation()}>
    {note ? <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent className="max-w-72 flex-col items-start gap-0.5">
        <span>Open {named} in OpenTig</span>
        <span className="opacity-80">{note}</span>
      </TooltipContent>
    </Tooltip> : link}
    <Tooltip>
      <TooltipTrigger render={<button
        type="button"
        className="repository-link-github"
        aria-label={`Open ${named} in GitHub`}
        onClick={() => { try { openExternalUrl(href); } catch { /* Not a URL the browser opens. */ } }}
      />}>
        <IconExternalLink aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>Open in GitHub</TooltipContent>
    </Tooltip>
  </span>;
}
