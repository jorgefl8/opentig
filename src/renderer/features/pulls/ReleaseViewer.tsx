import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconDots, IconLoader4, IconRefresh } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { formatDateTime } from '@shared/date-format';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MobileActionsMenu, MobileMainAction, MobileViewerActions, MobileViewerTitle, type MobileMenuItem } from '@/components/MobileChrome';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { LinkedMarkdown } from '@/features/markdown/LinkedMarkdown';
import { mobileMainAction } from '@/lib/mobile-main-action';
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
  const phone = useMobileChrome() !== null;
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
  const [moreButton, setMoreButton] = useState<HTMLButtonElement | null>(null);
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
    mutationFn: () => opentig.github.publishRelease({ ...expected(), expectedTagExists: release!.tagExists }),
    onSuccess: () => { setConfirming(null); sileo.success({ title: 'Release published', description: tagName }); },
    onError,
    onSettled: refresh,
  });
  const busy = remove.isPending || publish.isPending;
  const bar = <MobileViewerTitle title={tagName} />;

  if (query.isError && !release) {
    return (
      <div className="viewer-message flex-col gap-3">
        {bar}
        <p className="text-destructive">{query.error instanceof Error ? query.error.message : 'Could not load the release.'}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}><IconRefresh /> Try again</Button>
      </div>
    );
  }
  if (!release) return <div className="viewer-message">{bar}<IconLoader4 className="spinner" /> <ShimmeringText text={`Loading release ${tagName}…`} /></div>;

  if (editing) {
    const closeEditor = () => {
      setEditing(false);
      // The menu that opened the editor comes back with the header, or in the top bar on a phone.
      requestAnimationFrame(() => (header.current?.querySelector<HTMLElement>('.pr-more-actions') ?? document.querySelector<HTMLElement>('.mobile-toolbar .pr-more-actions'))?.focus());
    };
    return <>{bar}<ReleaseEditor repositoryId={repositoryId} release={release} onClose={closeEditor} /></>;
  }

  const canAct = release.viewerCanWrite && account?.state === 'ready' && Boolean(account.login);
  // A phone says who this acts as once, under the button, instead of in each sentence.
  const asViewer = account?.login && !phone ? <> as <strong>@{account.login}</strong></> : null;
  const footnote = account?.login ? `as @${account.login}` : undefined;
  const canOpen = Boolean(release.url) && !release.isDraft;
  const publishBlocked = !canAct ? 'Check the GitHub account in Settings.' : null;
  // A full hash is a fixed commit; anything else is a branch, whose latest commit GitHub tags when publishing.
  const target = /^[0-9a-f]{40}$/i.test(release.targetCommitish) ? release.targetCommitish.slice(0, 12) : release.targetCommitish;
  const targetIsBranch = target === release.targetCommitish;
  const askToDelete = () => { if (moreButton) setConfirming({ action: 'delete', anchor: moreButton }); };
  const menu: MobileMenuItem[] = [
    ...(canOpen ? [{ label: 'Open on GitHub', onSelect: () => openOnGitHub(release.url) }] : []),
    ...(release.viewerCanWrite ? [{ label: 'Edit title and notes…', disabled: !canAct, onSelect: () => setEditing(true) }] : []),
    ...(release.viewerCanWrite && release.isDraft ? [{ label: 'Delete draft…', danger: true, disabled: !canAct, onSelect: askToDelete }] : []),
  ];
  return (
    <div className="pr-viewer">
      {bar}
      {phone && menu.length > 0 && <MobileViewerActions>
        <MobileActionsMenu label="More release actions" title="Release" triggerRef={setMoreButton} triggerClassName="pr-more-actions" disabled={busy} items={menu} />
      </MobileViewerActions>}
      {phone && mobileMainAction({ screen: 'release', isDraft: release.isDraft, canWrite: release.viewerCanWrite }) === 'publish-release' && (
        <MobileMainAction note={publishBlocked}>
          <Button className="mobile-main-action" disabled={Boolean(publishBlocked) || busy} onClick={(event) => setConfirming({ action: 'publish', anchor: event.currentTarget })}>Publish</Button>
        </MobileMainAction>
      )}
      <header ref={header} className="pr-viewer-header no-tabs">
        <div className="pr-viewer-overview">
          <div className="pr-viewer-top">
            <div className="pr-viewer-heading"><h2>{release.name}</h2></div>
            <span className="pr-action-bar">
              {!release.viewerCanWrite && <span className="pr-action-reason">Changing releases requires write access</span>}
              {!phone && release.viewerCanWrite && release.isDraft && <Tooltip>
                <TooltipTrigger render={<Button size="xs" disabled={Boolean(publishBlocked) || busy} focusableWhenDisabled onClick={(event) => setConfirming({ action: 'publish', anchor: event.currentTarget })} />}>Publish</TooltipTrigger>
                {publishBlocked && <TooltipContent>{publishBlocked}</TooltipContent>}
              </Tooltip>}
              {!phone && (release.viewerCanWrite || canOpen) && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button ref={setMoreButton} variant="ghost" size="icon-xs" className="change-action-button pr-more-actions" aria-label="More release actions" disabled={busy} />}><IconDots /></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {menu.map((item) => <DropdownMenuItem key={item.label} disabled={item.disabled} onClick={item.onSelect}>{item.label}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          </div>
          <div className="pr-viewer-status">
            <span className={`pr-status tone-${releaseStateTone(release)}`}><span className="status-dot" aria-hidden="true" /> {releaseStateLabel(release)}</span>
            <span className="pr-branches">{release.tagName}</span>
            <span className="pr-branches">{target}</span>
            <span>{release.publishedAt ? <>published <time dateTime={release.publishedAt}>{formatDateTime(release.publishedAt)}</time></> : <>created <time dateTime={release.createdAt}>{formatDateTime(release.createdAt)}</time></>}</span>
            {release.isImmutable && <span>Immutable</span>}
            {release.isDraft && release.isPrerelease && <span>Pre-release</span>}
            {release.isDraft && !release.tagExists && <span>Publishing creates the tag</span>}
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
        title={`Publish ${release.tagName}`}
        footnote={footnote}
        busy={busy}
        onCancel={() => setConfirming(null)}
        confirm={<Button size="xs" disabled={busy} onClick={() => publish.mutate()}>{publish.isPending ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Publishing…" /></> : 'Publish release'}</Button>}
      >
        <p>Publish <strong>{release.name}</strong>{asViewer}? Anyone with access to the repository sees it, and any workflow that runs on publication starts.</p>
        {!release.tagExists && <p>The tag <code>{release.tagName}</code> doesn't exist yet, so GitHub creates it at {targetIsBranch ? <>the latest commit of <code>{target}</code></> : <code>{target}</code>}.</p>}
        <dl className="release-publish-facts">
          <div><dt>Tag</dt><dd><code>{release.tagName}</code>{release.tagExists ? null : ' (new)'}</dd></div>
          <div><dt>{targetIsBranch ? 'Branch' : 'Commit'}</dt><dd><code>{target}</code></dd></div>
          <div><dt>Pre-release</dt><dd>{release.isPrerelease ? 'Yes' : 'No'}</dd></div>
          <div><dt>Assets</dt><dd>{release.assets.length ? release.assets.map((asset) => asset.name).join(', ') : 'None. Check that nothing is missing.'}</dd></div>
        </dl>
      </ConfirmPopover>}
      {confirming?.action === 'delete' && <ConfirmPopover
        anchor={confirming.anchor}
        label="Confirm deletion"
        title="Delete draft"
        footnote={footnote}
        busy={busy}
        onCancel={() => setConfirming(null)}
        confirm={<Button variant="destructive" size="xs" disabled={busy} onClick={() => remove.mutate()}>{busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Deleting…" /></> : 'Delete draft'}</Button>}
      >
        <p>Delete the draft <strong>{release.name}</strong>{asViewer}? Its notes and {release.assets.length === 1 ? '1 asset are' : `${release.assets.length} assets are`} lost. The tag isn't touched.</p>
      </ConfirmPopover>}
    </div>
  );
}
