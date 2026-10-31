import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconDots, IconLoader4, IconRefresh } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { formatDateTime } from '@shared/date-format';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LinkedMarkdown } from '@/features/markdown/LinkedMarkdown';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ConfirmPopover } from './ConfirmPopover';
import { ghDetail, ghErrorTitle, isUncertainFailure, openOnGitHub, releaseStateLabel, releaseStateTone } from './gh-utils';
import { ReleaseEditor } from './ReleaseEditor';
import { hasViewerDraft, releaseEditDraft } from './viewer-drafts';
import { useGitHubAccount } from './useGitHubAccount';
import '@/features/markdown/markdown.css';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReleaseViewer({ repositoryId, tagName, onClose }: { repositoryId: string; tagName: string; onClose(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.release(repositoryId, tagName),
    queryFn: async () => {
      const release = await opentig.github.getRelease(repositoryId, tagName);
      const notesHtml = release.body.trim()
        ? await import('@/features/markdown/render-markdown').then(({ renderMarkdown }) => renderMarkdown(release.body)).catch(() => '<p>Could not render the notes.</p>')
        : '';
      return { release, notesHtml };
    },
  });
  const release = query.data?.release ?? null;
  const accountQuery = useGitHubAccount(release?.viewerCanWrite ? repositoryId : null);
  const account = accountQuery.data;
  const [editing, setEditing] = useState(() => hasViewerDraft(releaseEditDraft(repositoryId, tagName)));
  const [confirming, setConfirming] = useState<{ action: 'delete' | 'publish'; anchor: HTMLElement } | null>(null);
  const header = useRef<HTMLElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const stateKey = release ? [release.databaseId, release.isDraft, release.tagExists, release.bodyHash].join('|') : '';
  useEffect(() => { setConfirming(null); }, [stateKey]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.release(repositoryId, tagName) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.releases(repositoryId) });
  };
  const expected = () => {
    if (account?.state !== 'ready' || !account.login || !release) throw new Error('Check the GitHub account in Settings and try again.');
    return { repositoryId, tagName, expectedDatabaseId: release.databaseId, expectedAccount: { login: account.login, revision: account.revision } };
  };
  const onError = (reason: unknown) => {
    const detail = ghDetail(reason);
    if (isUncertainFailure(reason)) {
      // It may be done already, so the question goes and the release is read again.
      setConfirming(null);
      sileo.info({ title: 'No answer from GitHub yet', description: 'The action may have completed. OpenTig is checking the release.', duration: 10_000 });
    } else sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
    if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
  };
  const remove = useMutation({
    mutationFn: () => opentig.github.deleteDraftRelease(expected()),
    onSuccess: () => { sileo.success({ title: 'Draft release deleted', description: `${tagName}. The tag was kept.` }); onClose(); },
    onError,
    onSettled: refresh,
  });
  const publish = useMutation({
    mutationFn: () => opentig.github.publishRelease(expected()),
    onSuccess: () => { setConfirming(null); sileo.success({ title: 'Release published', description: tagName }); },
    onError,
    onSettled: refresh,
  });
  const busy = remove.isPending || publish.isPending;

  if (query.isError && !release) {
    return (
      <div className="viewer-message flex-col gap-3">
        <p className="text-destructive">{query.error instanceof Error ? query.error.message : 'Could not load the release.'}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}><IconRefresh /> Try again</Button>
      </div>
    );
  }
  if (!release) return <div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text={`Loading release ${tagName}…`} /></div>;

  if (editing) {
    const closeEditor = () => {
      setEditing(false);
      // The menu that opened the editor comes back with the header.
      requestAnimationFrame(() => header.current?.querySelector<HTMLElement>('.pr-more-actions')?.focus());
    };
    return <ReleaseEditor repositoryId={repositoryId} release={release} onClose={closeEditor} />;
  }

  const canAct = release.viewerCanWrite && account?.state === 'ready' && Boolean(account.login);
  const asViewer = account?.login ? <> as <strong>@{account.login}</strong></> : null;
  const canOpen = Boolean(release.url) && !release.isDraft;
  const publishBlocked = !release.tagExists ? "This tag doesn't exist yet. Create and push it to publish." : !canAct ? 'Check the GitHub account in Settings.' : null;
  return (
    <div className="pr-viewer">
      <header ref={header} className="pr-viewer-header no-tabs">
        <div className="pr-viewer-overview">
          <div className="pr-viewer-top">
            <div className="pr-viewer-heading"><h2>{release.name}</h2></div>
            <span className="pr-action-bar">
              {!release.viewerCanWrite && <span className="pr-action-reason">Changing releases requires write access</span>}
              {release.viewerCanWrite && release.isDraft && <Tooltip>
                <TooltipTrigger render={<Button size="xs" disabled={Boolean(publishBlocked) || busy} focusableWhenDisabled onClick={(event) => setConfirming({ action: 'publish', anchor: event.currentTarget })} />}>Publish</TooltipTrigger>
                {publishBlocked && <TooltipContent>{publishBlocked}</TooltipContent>}
              </Tooltip>}
              {(release.viewerCanWrite || canOpen) && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button ref={moreButton} variant="ghost" size="icon-xs" className="change-action-button pr-more-actions" aria-label="More release actions" disabled={busy} />}><IconDots /></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {canOpen && <DropdownMenuItem onClick={() => openOnGitHub(release.url)}>Open on GitHub</DropdownMenuItem>}
                    {release.viewerCanWrite && <DropdownMenuItem disabled={!canAct} onClick={() => setEditing(true)}>Edit title and notes…</DropdownMenuItem>}
                    {release.viewerCanWrite && release.isDraft && <DropdownMenuItem disabled={!canAct} onClick={() => { if (moreButton.current) setConfirming({ action: 'delete', anchor: moreButton.current }); }}>Delete draft…</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          </div>
          <div className="pr-viewer-status">
            <span className={`pr-status tone-${releaseStateTone(release)}`}><span className="status-dot" aria-hidden="true" /> {releaseStateLabel(release)}</span>
            <span className="pr-branches">{release.tagName}</span>
            <span className="pr-branches">{release.targetCommitish.slice(0, 12)}</span>
            <span>{release.publishedAt ? <>published <time dateTime={release.publishedAt}>{formatDateTime(release.publishedAt)}</time></> : <>created <time dateTime={release.createdAt}>{formatDateTime(release.createdAt)}</time></>}</span>
            {release.isImmutable && <span>Immutable</span>}
            {release.isDraft && release.isPrerelease && <span>Pre-release</span>}
            {!release.tagExists && <span className="pr-status tone-attention" role="status">This tag doesn't exist yet</span>}
          </div>
        </div>
      </header>
      <div className="markdown-preview-scroll pr-description-scroll">
        <section className="pr-summary-section release-notes">
          {query.data?.notesHtml ? <LinkedMarkdown html={query.data.notesHtml} /> : <p className="pr-empty-description">This release has no notes.</p>}
        </section>
        {release.assets.length > 0 && (
          <section className="release-assets" aria-label="Assets">
            <h3>Assets</h3>
            {release.assets.map((asset) => <div key={asset.name} className="release-asset"><span>{asset.name}</span><small>{formatSize(asset.size)}</small></div>)}
          </section>
        )}
      </div>
      {confirming?.action === 'publish' && <ConfirmPopover
        anchor={confirming.anchor}
        label="Confirm publication"
        busy={busy}
        onCancel={() => setConfirming(null)}
        confirm={<Button size="xs" disabled={busy} onClick={() => publish.mutate()}>{publish.isPending ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Publishing…" /></> : 'Publish release'}</Button>}
      >
        <p>Publish <strong>{release.name}</strong>{asViewer}? Anyone with access to the repository sees it, and any workflow that runs on publication starts.</p>
        <dl className="release-publish-facts">
          <div><dt>Tag</dt><dd><code>{release.tagName}</code></dd></div>
          <div><dt>Commit</dt><dd><code>{release.targetCommitish.slice(0, 12)}</code></dd></div>
          <div><dt>Pre-release</dt><dd>{release.isPrerelease ? 'Yes' : 'No'}</dd></div>
          <div><dt>Assets</dt><dd>{release.assets.length ? release.assets.map((asset) => asset.name).join(', ') : 'None. Check that nothing is missing.'}</dd></div>
        </dl>
      </ConfirmPopover>}
      {confirming?.action === 'delete' && <ConfirmPopover
        anchor={confirming.anchor}
        label="Confirm deletion"
        busy={busy}
        onCancel={() => setConfirming(null)}
        confirm={<Button variant="destructive" size="xs" disabled={busy} onClick={() => remove.mutate()}>{busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Deleting…" /></> : 'Delete draft'}</Button>}
      >
        <p>Delete the draft <strong>{release.name}</strong>{asViewer}? Its notes and {release.assets.length === 1 ? '1 asset are' : `${release.assets.length} assets are`} lost. The tag isn't touched.</p>
      </ConfirmPopover>}
    </div>
  );
}
