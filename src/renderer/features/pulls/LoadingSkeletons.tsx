import type { ReactNode } from 'react';

/** Opened with nothing known yet: the header's shape, so the viewer doesn't jump in from a spinner. */
export function ViewerSkeleton({ bar, label }: { bar: ReactNode; label: string }) {
  return (
    <div className="pr-viewer pr-viewer-skeleton" role="status" aria-label={label}>
      <LoadingWords label={label} />
      {bar}
      <header className="pr-viewer-header no-tabs">
        <span className="pr-skeleton-line title" />
        <span className="pr-skeleton-line meta" />
        <span className="pr-skeleton-line status" />
      </header>
      <div className="pr-description-skeleton"><span /><span /><span /></div>
    </div>
  );
}

/**
 * What a screen reader speaks: many announce a live region's text, not its label,
 * and the placeholders themselves are hidden from them.
 */
function LoadingWords({ label }: { label: string }) {
  return <span className="sr-only">{label}…</span>;
}

export type ListSkeletonKind = 'pull' | 'run' | 'release';

// Widths vary from row to row so the placeholder reads as a list rather than a block.
const TITLE_WIDTHS = ['72%', '54%', '64%', '46%', '68%', '58%', '50%', '62%'];
const META_WIDTHS = ['46%', '38%', '52%', '34%', '42%', '48%', '36%', '44%'];

/**
 * A list read for the first time: rows with the real rows' classes, so each
 * placeholder has their height and puts its blocks where the avatar or status
 * dot, the title and the date go, and nothing moves when the rows arrive. Each
 * block sits on a line of text that has nothing but a zero-width space, which
 * gives it the line's real height at any type size.
 */
export function ListSkeleton({ kind, label, rows = TITLE_WIDTHS.length }: { kind: ListSkeletonKind; label: string; rows?: number }) {
  return (
    <div className="list-skeleton" role="status" aria-label={label}>
      <LoadingWords label={label} />
      {Array.from({ length: rows }, (_, index) => {
        const bar = (width: string, className = '') => <>{'​'}<span className={`pr-skeleton-line list-skeleton-bar ${className}`} style={{ width }} /></>;
        const title = <span className="pull-line">
          <span className="pull-title">{bar(TITLE_WIDTHS[index % TITLE_WIDTHS.length]!)}</span>
          <span className="pull-age">{bar('32px')}</span>
        </span>;
        if (kind === 'release') return <div key={index} className="pull-item" aria-hidden="true">
          <span className="pull-main release-row"><span className="status-dot list-skeleton-dot" />{title}</span>
        </div>;
        return <div key={index} className={`pull-item${kind === 'run' ? ' action-run-item' : ''}`} aria-hidden="true">
          <span className={kind === 'run' ? 'action-run-body' : 'pull-main'}>
            <span className="pull-avatar-status"><span className="list-skeleton-avatar" /></span>
            {title}
            <span className={`pull-line${kind === 'run' ? ' action-run-meta' : ''}`}>
              <span className="pull-meta list-skeleton-fill">{bar(META_WIDTHS[index % META_WIDTHS.length]!)}</span>
              {/* A run's reference, in code type with a GitHub button beside it, is taller than the text: an unseen one keeps the line as tall. */}
              {kind === 'run' && <span className="action-run-event list-skeleton-spacer"><span className="repository-link-pair"><span className="action-run-ref plain">{'\u200b'}</span><span className="repository-link-github" /></span></span>}
            </span>
          </span>
        </div>;
      })}
    </div>
  );
}
