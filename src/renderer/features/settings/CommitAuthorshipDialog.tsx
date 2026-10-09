import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IconLoader4 } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { RepositoryInfo } from '@shared/contracts';
import { commitAuthorshipInputSchema, type CommitAuthorship } from '@shared/commit-authorship';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { authorshipSourceLabel } from './commit-authorship-copy';

export function CommitAuthorshipDialog({ repository, open, onOpenChange }: {
  repository: RepositoryInfo; open: boolean; onOpenChange(open: boolean): void;
}) {
  const client = useQueryClient();
  const [snapshot, setSnapshot] = useState<CommitAuthorship | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [review, setReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setReview(false); setError(null); setSnapshot(null);
    void client.fetchQuery({ queryKey: queryKeys.commitAuthorship(repository.id), queryFn: () => opentig.commits.authorship(repository.id), staleTime: 0 })
      .then((value) => { if (!cancelled) { setSnapshot(value); setName(value.author?.name ?? ''); setEmail(value.author?.email ?? ''); } })
      .catch((reason: unknown) => { if (!cancelled) setError(messageOf(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, open, repository.id]);

  const parsed = commitAuthorshipInputSchema.safeParse({ name, email, expectedRevision: snapshot?.revision });
  const apply = async () => {
    if (!parsed.success || !snapshot?.editable || saving) return;
    setSaving(true); setError(null);
    try {
      const result = await opentig.commits.setAuthorship(repository.id, parsed.data);
      await client.cancelQueries({ queryKey: queryKeys.commitAuthorship(repository.id) });
      client.setQueryData(queryKeys.commitAuthorship(repository.id), result);
      onOpenChange(false);
      sileo.success({ title: 'Commit authorship saved', description: 'Repository Git settings updated for future commits.' });
    } catch (reason) {
      const message = messageOf(reason); setError(message);
      sileo.error({ title: 'Could not save commit authorship', description: message });
    } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!saving) onOpenChange(value); }}>
    <DialogPopup className="github-authorship-dialog">
      <DialogTitle>{review ? 'Apply authorship to this repository' : 'Commit authorship'}</DialogTitle>
      <DialogDescription>{repository.name} · name and email used by Git for future commits.</DialogDescription>
      {loading ? <p className="github-authorship-loading" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /><ShimmeringText text="Reading the current Git identity…" /></p> : snapshot && <>
        <div className="github-authorship-review">
          <span>{review ? 'Current' : 'Current Git identity'}</span><strong>{snapshot.author?.name || 'Not configured'}</strong>
          <p>{snapshot.author?.email || 'No commit email configured'}</p><small>{authorshipSourceLabel(snapshot.source)}</small>
          {snapshot.committer && (snapshot.committer.name !== snapshot.author?.name || snapshot.committer.email !== snapshot.author?.email) && <p>Committer: {snapshot.committer.name} &lt;{snapshot.committer.email}&gt;</p>}
        </div>
        {snapshot.blockers.map((blocker) => <p className="github-settings-notice" key={blocker}>{blocker}</p>)}
        {review ? <div className="github-authorship-review next"><span>New author and committer</span><strong>{name.trim()}</strong><p>{email.trim()}</p><small>Repository Git settings</small></div>
          : <form id="commit-authorship-form" onSubmit={(event) => { event.preventDefault(); if (parsed.success && snapshot.editable) setReview(true); }}>
            <label htmlFor="commit-author-name">Name</label><input id="commit-author-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" maxLength={120} disabled={!snapshot.editable} required />
            <label htmlFor="commit-author-email">Commit email</label><input id="commit-author-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" maxLength={254} disabled={!snapshot.editable} required />
            <p className="github-settings-note">Choose an email associated with your GitHub account, or copy its exact noreply address from GitHub Settings → Emails. It is not inferred from the account login.</p>
          </form>}
        <p className="github-authorship-scope">Applies to this repository and its worktrees, including commits from other Git tools. Only future commits change. Global Git settings, gh, SSH and commit signing are kept.</p>
      </>}
      {error && <p className="github-settings-notice" role="alert">{error}</p>}
      <div className="github-add-actions">
        <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
        {review ? <><Button variant="outline" disabled={saving} onClick={() => setReview(false)}>Back</Button><Button disabled={saving || !snapshot?.editable} onClick={() => void apply()}>{saving && <IconLoader4 className="animate-spin" />}Apply to repository</Button></>
          : <Button type="submit" form="commit-authorship-form" disabled={loading || !snapshot?.editable || !parsed.success}>Review changes</Button>}
      </div>
    </DialogPopup>
  </Dialog>;
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Could not read Git identity.'; }
