import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconExternalLink, IconFile, IconGitCommit, IconLoader4, IconPencil, IconRefresh, IconRocket, IconTag, IconTrash } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { formatDateTime } from '@shared/date-format';
import { ActionConfirmPanel } from '@/components/ActionConfirmPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { LinkedMarkdown } from '@/features/markdown/LinkedMarkdown';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { EditReleaseDialog } from './EditReleaseDialog';
import { ghDetail, ghErrorTitle, isUncertainFailure, openOnGitHub, releaseStateLabel } from './gh-utils';
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
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<'delete' | 'publish' | null>(null);
  const cancel = useCallback(() => setConfirming(null), []);
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
    if (isUncertainFailure(reason)) sileo.info({ title: 'No answer from GitHub yet', description: 'The action may have completed. OpenTig is checking the release.', duration: 10_000 });
    else sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
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

  const canAct = release.viewerCanWrite && account?.state === 'ready' && Boolean(account.login);
  const label = releaseStateLabel(release);
  return (
    <div className="pr-viewer">
      <header className="pr-viewer-header">
        <div className="pr-viewer-overview">
          <div className="pr-viewer-title">
            <Badge variant={release.isLatest ? 'default' : 'secondary'}>{label}</Badge>
            <h2>{release.name}</h2>
          </div>
          <div className="pr-viewer-meta">
            <span className="pr-branches"><IconTag aria-hidden="true" /> {release.tagName}</span>
            <span aria-hidden="true">·</span>
            <span className="pr-branches"><IconGitCommit aria-hidden="true" /> {release.targetCommitish.slice(0, 12)}</span>
            <span aria-hidden="true">·</span>
            <span>{release.publishedAt ? <>published <time dateTime={release.publishedAt}>{formatDateTime(release.publishedAt)}</time></> : <>created <time dateTime={release.createdAt}>{formatDateTime(release.createdAt)}</time></>}</span>
            {release.isImmutable && <Badge variant="outline">Immutable</Badge>}
            {release.isDraft && release.isPrerelease && <Badge variant="outline">Pre-release</Badge>}
            {release.url && !release.isDraft && <span className="pr-viewer-actions"><Button variant="outline" size="xs" onClick={() => openOnGitHub(release.url)}><IconExternalLink /> Open on GitHub</Button></span>}
          </div>
          <div className="pr-viewer-status">
            {!release.tagExists && <span className="pr-status attention" role="status">This tag doesn't exist yet</span>}
            {release.viewerCanWrite ? <span className="pr-action-bar">
              {release.isDraft && <Button size="xs" disabled={!canAct || busy || confirming !== null || !release.tagExists} onClick={() => setConfirming('publish')}><IconRocket /> Publish</Button>}
              <Button variant="outline" size="xs" disabled={!canAct || busy} onClick={() => setEditing(true)}><IconPencil /> Edit</Button>
              {release.isDraft && <Button variant="ghost" size="xs" disabled={!canAct || busy || confirming !== null} onClick={() => setConfirming('delete')}><IconTrash /> Delete draft</Button>}
            </span> : <span className="pr-action-reason">Changing releases requires write access</span>}
            {confirming === 'publish' && (
              <div className="pr-action-panel">
                <ActionConfirmPanel tone="warning" busy={busy} onCancel={cancel} confirm={<Button size="sm" disabled={busy} onClick={() => publish.mutate()}>{publish.isPending ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Publishing…" /></> : 'Publish release'}</Button>}>
                  <p>Publish <strong>{release.name}</strong>{account?.login ? <> as <strong>@{account.login}</strong></> : null}? Anyone with access to the repository sees it, and any workflow that runs on publication starts.</p>
                  <dl className="release-publish-facts">
                    <div><dt>Tag</dt><dd><code>{release.tagName}</code></dd></div>
                    <div><dt>Commit</dt><dd><code>{release.targetCommitish.slice(0, 12)}</code></dd></div>
                    <div><dt>Pre-release</dt><dd>{release.isPrerelease ? 'Yes' : 'No'}</dd></div>
                    <div><dt>Assets</dt><dd>{release.assets.length ? release.assets.map((asset) => asset.name).join(', ') : 'None. Check that nothing is missing.'}</dd></div>
                  </dl>
                </ActionConfirmPanel>
              </div>
            )}
            {confirming === 'delete' && (
              <div className="pr-action-panel">
                <ActionConfirmPanel busy={busy} onCancel={cancel} confirm={<Button variant="destructive" size="sm" disabled={busy} onClick={() => remove.mutate()}>{busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Deleting…" /></> : 'Delete draft'}</Button>}>
                  <p>Delete the draft <strong>{release.name}</strong>{account?.login ? <> as <strong>@{account.login}</strong></> : null}? Its notes and {release.assets.length === 1 ? '1 asset are' : `${release.assets.length} assets are`} lost. The tag isn't touched.</p>
                </ActionConfirmPanel>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="markdown-preview-scroll pr-description-scroll">
        <section className="pr-summary-section release-notes">
          {query.data?.notesHtml ? <LinkedMarkdown html={query.data.notesHtml} /> : <p className="pr-empty-description">This release has no notes.</p>}
        </section>
        {release.assets.length > 0 && (
          <section className="release-assets" aria-label="Assets">
            <h3><IconFile aria-hidden="true" /> Assets</h3>
            {release.assets.map((asset) => <div key={asset.name} className="release-asset"><span>{asset.name}</span><small>{formatSize(asset.size)}</small></div>)}
          </section>
        )}
      </div>
      {editing && <EditReleaseDialog repositoryId={repositoryId} release={release} onClose={() => setEditing(false)} />}
    </div>
  );
}
