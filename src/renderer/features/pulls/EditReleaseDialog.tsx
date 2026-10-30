import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconLoader4, IconPencil } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { ReleaseDetails } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';

/** The notes are edited raw, so markers kept in them by automation stay exactly as they were. */
export function EditReleaseDialog({ repositoryId, release, onClose }: { repositoryId: string; release: ReleaseDetails; onClose(): void }) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const [title, setTitle] = useState(release.name);
  const [notes, setNotes] = useState(release.body);
  const save = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.updateRelease({ repositoryId, tagName: release.tagName, expectedDatabaseId: release.databaseId, expectedBodyHash: release.bodyHash, title: title.trim(), notes, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      sileo.success({ title: 'Release updated', description: release.tagName });
      onClose();
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) sileo.info({ title: 'No answer from GitHub yet', description: 'Your changes may have been saved. Check the release before saving again.', duration: 10_000 });
      else sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.release(repositoryId, release.tagName) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.releases(repositoryId) });
    },
  });
  const busy = save.isPending;
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogPopup className="create-pr-dialog">
        <div className="create-pr-content">
          <DialogTitle><IconPencil aria-hidden="true" /> Edit {release.tagName}</DialogTitle>
          <DialogDescription>{account?.login ? <>Saved as @{account.login}. </> : null}If the notes change on GitHub first, nothing is overwritten.</DialogDescription>
          <div className="create-pr-field">
            <label htmlFor="edit-release-title">Title</label>
            <input id="edit-release-title" className="create-pr-title" value={title} maxLength={300} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <MarkdownField id="edit-release-notes" label="Notes" value={notes} rows={14} placeholder="Describe the release (GitHub Markdown)" emptyPreview="_No notes._" disabled={busy} onChange={setNotes} />
        </div>
        <div className="create-pr-actions">
          <div className="create-pr-submit-actions">
            <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !title.trim() || account?.state !== 'ready'} onClick={() => save.mutate()}>
              {busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Saving…" /></> : 'Save changes'}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
