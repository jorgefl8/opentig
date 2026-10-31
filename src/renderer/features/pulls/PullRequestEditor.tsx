import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { PullRequestDetails } from '../../../shared/contracts';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';
import { pullRequestEditDraft, useViewerDraft } from './viewer-drafts';
import { ViewerEditor } from './ViewerEditor';

export function PullRequestEditor({ repositoryId, details, onClose }: {
  repositoryId: string;
  details: PullRequestDetails;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  // The version stays the one the text came from: polling must not move it, or GitHub's newer edits would be overwritten.
  const [draft, setDraft, discardDraft] = useViewerDraft(pullRequestEditDraft(repositoryId, details.number), () => ({ title: details.title, body: details.body, expectedUpdatedAt: details.updatedAt }));
  const { title, body } = draft;
  // Once told GitHub changed first, saving again is a decision to replace that version.
  const [changedFirst, setChangedFirst] = useState(false);
  const expectedUpdatedAt = changedFirst ? details.updatedAt : draft.expectedUpdatedAt;
  const close = () => { discardDraft(); onClose(); };
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
      close();
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) sileo.info({ title: 'No answer from GitHub yet', description: 'Your changes may have been saved. Check the pull request before saving again.', duration: 10_000 });
      else sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      if (detail?.code === 'GH_PR_STATE_CHANGED') setChangedFirst(true);
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: refreshPull,
  });
  const busy = save.isPending;
  return (
    <ViewerEditor
      titleId="edit-pr-title"
      title={title}
      edited={title !== details.title || body !== details.body}
      busy={busy}
      canSave={account?.state === 'ready'}
      note={`${account?.login ? `Saved as @${account.login}. ` : ''}${changedFirst ? 'It changed on GitHub first: saving again replaces that version.' : 'If it changes on GitHub first, nothing is overwritten.'}`}
      onTitleChange={(next) => setDraft({ ...draft, title: next })}
      onSave={() => save.mutate()}
      onClose={close}
    >
      <MarkdownField id="edit-pr-body" label="Description" value={body} rows={12} placeholder="Describe the change (GitHub Markdown)" emptyPreview="_No description._" disabled={busy} onChange={(next) => setDraft({ ...draft, body: next })} />
    </ViewerEditor>
  );
}
