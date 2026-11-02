import { useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconDots, IconLoader4 } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { PullRequestConversationEntry } from '../../../shared/contracts';
import { MobileSheet } from '@/components/MobileSheet';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { ConfirmPopover } from './ConfirmPopover';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';
import { pullRequestEntryEditDraft, useViewerDraft } from './viewer-drafts';

interface EntryProps {
  repositoryId: string;
  number: number;
  entry: PullRequestConversationEntry;
}

const refreshed = ['pull-request-conversation', 'pull-request-state', 'pull-request', 'pulls'];
const showFailure = (reason: unknown) => {
  const detail = ghDetail(reason);
  sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
  return detail;
};

/** Only rendered for the viewer's own text. Deleting, which only comments allow, asks first because GitHub keeps no copy. */
export function PullRequestEntryMenu({ repositoryId, number, entry, onEdit }: EntryProps & { onEdit(): void }) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const [asking, setAsking] = useState(false);
  const phone = useMobileChrome() !== null;
  const noun = entry.kind === 'review' ? 'review' : 'comment';
  const remove = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.deletePullRequestEntry({ repositoryId, number, entryId: entry.id, expectedUpdatedAt: entry.updatedAt, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      setAsking(false);
      sileo.success({ title: 'Comment deleted', description: `#${number}` });
    },
    onError: (reason) => {
      setAsking(false);
      if (isUncertainFailure(reason)) {
        sileo.info({ title: 'No answer from GitHub yet', description: 'It may have been deleted. Check the conversation.', duration: 10_000 });
        return;
      }
      if (showFailure(reason)?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      for (const resource of refreshed) void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, resource] });
    },
  });
  const busy = remove.isPending;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button ref={setButton} variant="ghost" size="icon-xs" className="change-action-button" aria-label={`More actions for this ${noun}`} disabled={busy} />}><IconDots /></DropdownMenuTrigger>
      <DropdownMenuContent>
        {entry.canEdit && <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>}
        {entry.canDelete && <DropdownMenuItem onClick={() => setAsking(true)}>Delete</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
    {asking && button && (
      <ConfirmPopover
        anchor={button}
        label="Confirm deleting this comment"
        title="Delete comment"
        footnote={account?.login ? `as @${account.login}` : undefined}
        busy={busy}
        confirm={<Button variant="destructive" size="xs" disabled={busy} onClick={() => remove.mutate()}>{busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Deleting…" /></> : 'Delete comment'}</Button>}
        onCancel={() => setAsking(false)}
      >
        <p>Delete this comment from GitHub{account?.login && !phone ? <> as <strong>@{account.login}</strong></> : null}? This can't be undone.</p>
      </ConfirmPopover>
    )}
  </>;
}

/** Takes the text's place, or opens a sheet on a phone. Closing that sheet keeps what was typed; Cancel throws it away. */
export function PullRequestEntryEditor({ repositoryId, number, entry, onClose }: EntryProps & { onClose(): void }) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const phone = useMobileChrome() !== null;
  // The version stays the one the text came from: a refresh must not move it, or GitHub's newer edits would be overwritten.
  const [draft, setDraft, discardDraft] = useViewerDraft(pullRequestEntryEditDraft(repositoryId, number, entry.id), () => ({ body: entry.body, expectedUpdatedAt: entry.updatedAt }));
  // Once told GitHub changed first, saving again is a decision to replace that version.
  const [changedFirst, setChangedFirst] = useState(false);
  const noun = entry.kind === 'review' ? 'review' : 'comment';
  const cancel = () => { discardDraft(); onClose(); };
  const save = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      return opentig.github.editPullRequestEntry({ repositoryId, number, entryId: entry.id, body: draft.body, expectedUpdatedAt: changedFirst ? entry.updatedAt : draft.expectedUpdatedAt, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      sileo.success({ title: noun === 'review' ? 'Review updated' : 'Comment updated', description: `#${number}` });
      cancel();
    },
    onError: (reason) => {
      if (isUncertainFailure(reason)) {
        sileo.info({ title: 'No answer from GitHub yet', description: 'Your changes may have been saved. Check the conversation before saving again.', duration: 10_000 });
        return;
      }
      const detail = showFailure(reason);
      if (detail?.code === 'GH_PR_STATE_CHANGED') setChangedFirst(true);
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      for (const resource of refreshed) void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, resource] });
    },
  });
  const busy = save.isPending;
  const edited = draft.body !== entry.body;
  const canSave = !busy && account?.state === 'ready' && Boolean(draft.body.trim()) && (edited || changedFirst);
  const note = changedFirst ? 'It changed on GitHub first: saving again replaces that version.' : account?.login ? `Saving as @${account.login}` : null;
  const field = <MarkdownField id={`pr-entry-${entry.id}`} label={phone ? 'Text' : `Edit ${noun}`} value={draft.body} rows={4} placeholder="Write a comment (GitHub Markdown)" emptyPreview="_Nothing to preview._" disabled={busy} onChange={(body) => setDraft({ ...draft, body })} />;
  const saveButton = <Button size="xs" disabled={!canSave} onClick={() => save.mutate()}>{busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Saving…" /></> : 'Save changes'}</Button>;
  const cancelButton = <Button variant="ghost" size="xs" disabled={busy} onClick={cancel}>Cancel</Button>;
  if (phone) {
    return (
      <MobileSheet open onOpenChange={(next) => { if (!next && !busy) { if (edited) onClose(); else cancel(); } }} title={`Edit ${noun}`} locked={busy}>
        <div className="pr-composer">
          {field}
          <div className="confirm-sheet-actions">
            {saveButton}
            {cancelButton}
            {note && <small>{note}</small>}
          </div>
        </div>
      </MobileSheet>
    );
  }
  // Escape only leaves untouched text, so a stray key can't throw it away.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Escape' && !edited && !busy) cancel(); };
  return (
    <div className="pr-composer pr-entry-editor" onKeyDown={onKeyDown}>
      {field}
      <div className="pr-composer-actions">
        {note && <span className="pr-composer-account">{note}</span>}
        {cancelButton}
        {saveButton}
      </div>
    </div>
  );
}
