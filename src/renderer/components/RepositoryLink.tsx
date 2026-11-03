import { useContext, type ReactNode } from 'react';
import { IconBrandGithub } from '@tabler/icons-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { openExternalUrl } from '@/lib/browser-capabilities';
import { OpenTigMark } from './OpenTigMark';
import { RepositoryLinksContext, repositoryLinkLabel, repositoryLinkUrl, type RepositoryLinkTarget } from './repository-links';

/**
 * A reference to something OpenTig can open, asking where, as the branch's pull
 * request does: in OpenTig or on GitHub. Without a GitHub repository open, it's
 * whatever `fallback` is.
 */
export function RepositoryLink({ target, url, className, id, label, note, fallback, children, html }: {
  target: RepositoryLinkTarget;
  /** The link as written; otherwise the canonical one is built. */
  url?: string;
  className?: string;
  id?: string | undefined;
  label?: string;
  /** A line under the menu's title, for what the reference is. */
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
  // React passes the menu's clicks up through its portal, so a clickable row or entry around the link would act on them too.
  return <span className="contents" onClick={(event) => event.stopPropagation()}><DropdownMenu>
    <DropdownMenuTrigger
      render={<button type="button" id={id || undefined} className={`repository-link ${className ?? ''}`} aria-label={label} />}
      {...(html === undefined ? { children } : { dangerouslySetInnerHTML: { __html: html } })}
    />
    <DropdownMenuContent align="start" aria-label={`Open ${title.toLowerCase()}`} className="w-64 max-w-[calc(100vw-2rem)]">
      <div className="mb-1 space-y-1 border-b border-border px-2 pt-1.5 pb-2">
        <p className="text-xs leading-relaxed font-medium wrap-anywhere">{title}</p>
        {note && <p className="text-(length:--text-meta) leading-relaxed text-muted-foreground">{note}</p>}
      </div>
      <DropdownMenuItem onClick={() => links.open(target)}><OpenTigMark /> Open in OpenTig</DropdownMenuItem>
      <DropdownMenuItem onClick={() => { try { openExternalUrl(href); } catch { /* Not a URL the browser opens. */ } }}><IconBrandGithub aria-hidden="true" /> Open in GitHub</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu></span>;
}
