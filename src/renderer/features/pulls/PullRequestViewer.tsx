import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { IconExternalLink, IconGitBranch, IconLoader4, IconRefresh } from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, PullRequestDetails, ThemePreference } from '../../../shared/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { renderMarkdown } from '@/features/markdown/render-markdown';
import { openOnGitHub, prStateLabel, reviewDecisionLabel } from './gh-utils';
import '@/features/markdown/markdown.css';

const PullRequestDiff = lazy(() => import('./PullRequestDiff'));

interface PullRequestViewerProps {
  repositoryId: string;
  prNumber: number;
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  onDiffViewChange(value: DiffViewPreference): void;
  onWrapLinesChange(value: boolean): void;
  onClose(): void;
}

export function PullRequestViewer({ repositoryId, prNumber, diffView, themeType, wrapLines, onDiffViewChange, onWrapLinesChange, onClose }: PullRequestViewerProps) {
  const [tab, setTab] = useState<'description' | 'diff'>('description');
  const [details, setDetails] = useState<PullRequestDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [bodyHtml, setBodyHtml] = useState('');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestToken = useRef(0);

  useEffect(() => {
    const token = ++requestToken.current;
    setDetails(null);
    setDetailsError(null);
    setDiff(null);
    setDiffError(null);
    window.justgit.github.getPullRequest(repositoryId, prNumber).then(async (value) => {
      if (token !== requestToken.current) return;
      const html = value.body.trim() ? await renderMarkdown(value.body).catch(() => '<p>Could not render the description.</p>') : '';
      if (token !== requestToken.current) return;
      setDetails(value);
      setBodyHtml(html);
    }).catch((reason) => {
      if (token === requestToken.current) setDetailsError(reason instanceof Error ? reason.message : 'Could not load the pull request.');
    });
  }, [prNumber, reloadToken, repositoryId]);

  useEffect(() => {
    if (tab !== 'diff' || diff || diffError || !details) return;
    const token = requestToken.current;
    window.justgit.github.getPullRequestDiff(repositoryId, prNumber).then((value) => {
      if (token === requestToken.current) setDiff(value);
    }).catch((reason) => {
      if (token === requestToken.current) setDiffError(reason instanceof Error ? reason.message : 'Could not load the diff.');
    });
  }, [details, diff, diffError, prNumber, repositoryId, tab]);

  if (detailsError) {
    return (
      <div className="viewer-message flex-col gap-3">
        <p className="text-destructive">{detailsError}</p>
        <Button variant="outline" size="sm" onClick={() => setReloadToken((value) => value + 1)}><IconRefresh /> Try again</Button>
      </div>
    );
  }
  if (!details) {
    return <div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text={`Loading pull request #${prNumber}…`} /></div>;
  }

  const stateLabel = prStateLabel(details);
  const review = reviewDecisionLabel(details.reviewDecision);
  return (
    <div className="pr-viewer">
      <header className="pr-viewer-header">
        <div className="pr-viewer-title">
          <Badge variant={details.state === 'OPEN' && !details.isDraft ? 'default' : 'secondary'} className={`pr-state-badge ${stateLabel.toLowerCase().replace(/\s+/g, '-')}`}>{stateLabel}</Badge>
          <h2>{details.title || '(no title)'} <span className="pr-number">#{details.number}</span></h2>
        </div>
        <div className="pr-viewer-meta">
          <span className="pr-author">{details.author}</span>
          <span aria-hidden="true">·</span>
          <span>updated {formatRelativeDate(details.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span className="pr-branches"><IconGitBranch aria-hidden="true" /> {details.headRefName} → {details.baseRefName}</span>
          <span aria-hidden="true">·</span>
          <span className="pr-counters">
            {details.changedFiles} {details.changedFiles === 1 ? 'file' : 'files'}
            {' '}<span className="add">+{details.additions}</span> <span className="del">−{details.deletions}</span>
          </span>
          {review && <Badge variant="outline" className="pr-review-badge">{review}</Badge>}
          <span className="pr-viewer-actions">
            <Button variant="outline" size="xs" onClick={() => openOnGitHub(details.url)}><IconExternalLink /> Open on GitHub</Button>
          </span>
        </div>
        <div role="tablist" aria-label="Pull request view" className="markdown-viewer-tabs pr-viewer-tabs">
          <button type="button" role="tab" aria-selected={tab === 'description'} onClick={() => setTab('description')}>Summary</button>
          <button type="button" role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')}>Code</button>
        </div>
      </header>
      {tab === 'description' ? (
        <div className="markdown-preview-scroll pr-description-scroll">
          {bodyHtml
            ? <div className="markdown-prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            : <div className="viewer-message">This pull request has no description.</div>}
        </div>
      ) : diffError ? (
        <div className="viewer-message text-destructive">{diffError}</div>
      ) : !diff ? (
        <div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading diff…" /></div>
      ) : (
        <Suspense fallback={<div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading diff viewer…" /></div>}>
          <PullRequestDiff diff={diff} prNumber={details.number} diffView={diffView} themeType={themeType} wrapLines={wrapLines} onDiffViewChange={onDiffViewChange} onWrapLinesChange={onWrapLinesChange} onClose={onClose} />
        </Suspense>
      )}
    </div>
  );
}

function formatRelativeDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, amount] of divisions) if (Math.abs(seconds) >= amount) return formatter.format(Math.round(seconds / amount), unit);
  return formatter.format(seconds, 'second');
}
