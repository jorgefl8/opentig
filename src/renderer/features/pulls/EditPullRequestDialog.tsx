import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconLoader4, IconPencil } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { PullRequestDetails } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';

export function EditPullRequestDialog({ repositoryId, details, expectedUpdatedAt, onClose }: {
  repositoryId: string;
  details: PullRequestDetails;
  /** When the text being edited was current. GitHub's newer edits are not overwritten. */
  expectedUpdatedAt: string;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const [title, setTitle] = useState(details.title);
  const [body, setBody] = useState(details.body);
  const refreshPull = () => {
    for (const resource of ['pull-request', 'pull-request-state', 'pulls', 'branch-pull-request']) void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, resource] });
  };
  const save = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.updatePullRequest({ repositoryId, number: details.number, title: title.trim(), body, expectedUpdatedAt, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pullRequest(repositoryId, details.number) });
      sileo.success({ title: 'Pull request updated', description: `#${details.number}` });
      onClose();
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) sileo.info({ title: 'No answer from GitHub yet', description: 'Your changes may have been saved. Check the pull request before saving again.', duration: 10_000 });
      else sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: refreshPull,
  });
  const busy = save.isPending;
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogPopup className="create-pr-dialog">
        <div className="create-pr-content">
          <DialogTitle><IconPencil aria-hidden="true" /> Edit pull request #{details.number}</DialogTitle>
          <DialogDescription>{account?.login ? <>Saved as @{account.login}. If it changes on GitHub first, nothing is overwritten.</> : 'If it changes on GitHub first, nothing is overwritten.'}</DialogDescription>
          <div className="create-pr-field">
            <label htmlFor="edit-pr-title">Title</label>
            <input id="edit-pr-title" className="create-pr-title" value={title} maxLength={300} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <MarkdownField id="edit-pr-body" label="Description" value={body} rows={12} placeholder="Describe the change (GitHub Markdown)" emptyPreview="_No description._" disabled={busy} onChange={setBody} />
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
