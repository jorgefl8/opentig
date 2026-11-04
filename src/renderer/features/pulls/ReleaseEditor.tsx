import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ReleaseDetails } from '../../../shared/contracts';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';
import { releaseEditDraft, useViewerDraft } from './viewer-drafts';
import { ViewerEditor } from './ViewerEditor';

/** The notes are edited raw, so markers kept in them by automation stay exactly as they were. */
export function ReleaseEditor({ repositoryId, release, onClose }: { repositoryId: string; release: ReleaseDetails; onClose(): void }) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  // The version stays the one the text came from: a refetch must not move it, or GitHub's newer notes would be overwritten.
  const [draft, setDraft, discardDraft] = useViewerDraft(releaseEditDraft(repositoryId, release.tagName), () => ({ title: release.name, notes: release.body, expectedDatabaseId: release.databaseId, expectedBodyHash: release.bodyHash }));
  const { title, notes } = draft;
  // Once told GitHub changed first, saving again is a decision to replace that version.
  const [changedFirst, setChangedFirst] = useState(false);
  const close = () => { discardDraft(); onClose(); };
  const save = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.updateRelease({ repositoryId, tagName: release.tagName, expectedDatabaseId: changedFirst ? release.databaseId : draft.expectedDatabaseId, expectedBodyHash: changedFirst ? release.bodyHash : draft.expectedBodyHash, title: title.trim(), notes, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      sileo.success({ title: 'Release updated', description: release.tagName });
      close();
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) sileo.info({ title: 'No answer from GitHub yet', description: 'Your changes may have been saved. Check the release before saving again.', duration: 10_000 });
      else sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      if (detail?.code === 'GH_PR_STATE_CHANGED') setChangedFirst(true);
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.release(repositoryId, release.tagName) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.releases(repositoryId) });
    },
  });
  const busy = save.isPending;
  return (
    <ViewerEditor
      titleId="edit-release-title"
      title={title}
      edited={title !== release.name || notes !== release.body}
      busy={busy}
      canSave={account?.state === 'ready'}
      note={`${account?.login ? `Saved as @${account.login}. ` : ''}GitHub Markdown, as it's stored. ${changedFirst ? 'The notes changed on GitHub first: saving again replaces that version.' : 'If the notes change on GitHub first, nothing is overwritten.'}`}
      onTitleChange={(next) => setDraft({ ...draft, title: next })}
      onSave={() => save.mutate()}
      onClose={close}
    >
      <MarkdownField id="edit-release-notes" label="Notes" value={notes} rows={14} placeholder="Describe the release (GitHub Markdown)" emptyPreview="_No notes._" disabled={busy} onChange={(next) => setDraft({ ...draft, notes: next })} />
    </ViewerEditor>
  );
}
