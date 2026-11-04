import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCheck, IconLoader4 } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ReleaseTagCheck } from '@shared/contracts';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';

export function CreateReleaseDialog({ repositoryId, onClose, onCreated }: { repositoryId: string; onClose(): void; onCreated(tagName: string): void }) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  const [tagName, setTagName] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [generateNotes, setGenerateNotes] = useState(false);
  const [prerelease, setPrerelease] = useState(false);
  // Untouched, the target follows the default branch, as on GitHub's page.
  const [target, setTarget] = useState<string | null>(null);
  const tag = tagName.trim();
  // The tag is looked up once typing pauses, so the answer is there before creating, as on GitHub.
  const checkedTag = useDebouncedValue(tag, 400);
  const tagQuery = useQuery({
    queryKey: queryKeys.releaseTag(repositoryId, checkedTag),
    queryFn: () => opentig.github.checkReleaseTag(repositoryId, checkedTag),
    enabled: checkedTag !== '',
    retry: false,
  });
  const check = checkedTag === tag && tagQuery.isSuccess ? tagQuery.data : null;
  const targetValue = (target ?? check?.defaultBranch ?? '').trim();
  const ready = check !== null && !check.hasRelease && (check.exists || targetValue !== '');
  const create = useMutation({
    mutationFn: () => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      if (!check) throw new Error('Wait for the tag to be checked and try again.');
      return opentig.github.createRelease({ repositoryId, tagName: tag, title: title.trim(), notes, generateNotes, prerelease, expectedTagExists: check.exists, target: check.exists ? null : targetValue, expectedAccount: { login: account.login, revision: account.revision } });
    },
    onSuccess: () => {
      sileo.success({ title: 'Draft release created', description: tagName.trim() });
      onCreated(tagName.trim());
      onClose();
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) sileo.info({ title: 'No answer from GitHub yet', description: 'The draft may have been created. Check the list before trying again.', duration: 10_000 });
      else sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.releases(repositoryId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.releaseTag(repositoryId, tag) });
    },
  });
  const busy = create.isPending;
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogPopup className="create-pr-dialog">
        <div className="create-pr-content">
          <DialogTitle>New draft release</DialogTitle>
          <DialogDescription>{account?.login ? <>Created as @{account.login}. </> : null}Nothing is published until you choose to.</DialogDescription>
          <div className="release-create-fields">
            <div className="create-pr-field">
              <label htmlFor="release-tag">Tag</label>
              <input id="release-tag" className="field-input" value={tagName} maxLength={250} placeholder="v1.2.3" autoComplete="off" spellCheck={false} disabled={busy} onChange={(event) => setTagName(event.target.value)} />
            </div>
            <div className="create-pr-field">
              <label htmlFor="release-title">Title</label>
              <input id="release-title" className="field-input" value={title} maxLength={300} placeholder="Release title" disabled={busy} onChange={(event) => setTitle(event.target.value)} />
            </div>
            {check && !check.exists && !check.hasRelease && (
              <div className="create-pr-field">
                <label htmlFor="release-target">Create the tag from</label>
                <input id="release-target" className="field-input" value={target ?? check.defaultBranch ?? ''} maxLength={250} placeholder="Branch or commit" autoComplete="off" spellCheck={false} disabled={busy} onChange={(event) => setTarget(event.target.value)} />
              </div>
            )}
          </div>
          <TagStatus tag={tag} check={check} checking={tag !== '' && !check && !tagQuery.isError} error={checkedTag === tag && tagQuery.isError ? tagQuery.error : null} onRetry={() => void tagQuery.refetch()} />
          <MarkdownField id="release-notes" label="Notes" value={notes} rows={9} placeholder="Describe the release (GitHub Markdown)" emptyPreview="_No notes._" disabled={busy} onChange={setNotes} />
          <div className="release-create-options">
            <label><Checkbox checked={generateNotes} disabled={busy} onCheckedChange={(checked) => setGenerateNotes(checked === true)} /> Add notes generated by GitHub</label>
            <label><Checkbox checked={prerelease} disabled={busy} onCheckedChange={(checked) => setPrerelease(checked === true)} /> Pre-release</label>
          </div>
        </div>
        <div className="create-pr-actions">
          <div className="create-pr-submit-actions">
            <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !ready || !title.trim() || account?.state !== 'ready'} onClick={() => create.mutate()}>
              {busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Creating…" /></> : 'Create draft'}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** One line under the fields, so whether the tag exists is known before creating, not after. */
function TagStatus({ tag, check, checking, error, onRetry }: { tag: string; check: ReleaseTagCheck | null; checking: boolean; error: unknown; onRetry(): void }) {
  if (!tag) return <p className="release-tag-status">Use an existing tag, or a new one that GitHub creates when the release is published.</p>;
  if (error) {
    return (
      <p className="release-tag-status tone-attention" role="status">
        {ghDetail(error)?.message ?? "Couldn't check the tag."}
        <Button variant="ghost" size="xs" onClick={onRetry}>Retry</Button>
      </p>
    );
  }
  if (checking || !check) return <p className="release-tag-status" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> Checking <code>{tag}</code> on GitHub…</p>;
  if (check.hasRelease) return <p className="release-tag-status tone-attention" role="status"><code>{tag}</code> already has a release. Edit that one instead.</p>;
  if (check.exists) return <p className="release-tag-status" role="status"><IconCheck aria-hidden="true" /> <code>{tag}</code> exists on GitHub.</p>;
  return <p className="release-tag-status" role="status"><code>{tag}</code> is a new tag. GitHub creates it from the branch or commit above when the release is published.</p>;
}
