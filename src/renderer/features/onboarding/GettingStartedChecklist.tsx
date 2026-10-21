import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IconCheck, IconLoader4, IconX } from '@tabler/icons-react';
import type { RepositoryInfo } from '@shared/contracts';
import type { CommitAuthorship } from '@shared/commit-authorship';
import { gitIdentityInputSchema } from '@shared/onboarding';
import { Button } from '@/components/ui/button';
import type { SettingsSection } from '@/features/settings/SettingsDialog';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { needsIdentity } from './onboarding-model';
import { githubCheck, type GitHubCheck } from './useToolChecks';
import './onboarding.css';

/** What a new user still needs before their first commit and pull request. */
export function GettingStartedChecklist({ repository, onDismiss, onSettings }: {
  repository: RepositoryInfo;
  onDismiss(): void;
  onSettings(section: SettingsSection): void;
}) {
  const client = useQueryClient();
  const [authorship, setAuthorship] = useState<CommitAuthorship | null>(null);
  const [github, setGithub] = useState<GitHubCheck>('pending');
  const [githubSkipped, setGithubSkipped] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState<'global' | 'repository' | null>(null);
  const [error, setError] = useState('');

  const loadAuthorship = useCallback(async () => {
    const value = await opentig.commits.authorship(repository.id);
    setAuthorship(value);
    setName(current => current || value.author?.name || '');
    setEmail(current => current || value.author?.email || '');
  }, [repository.id]);
  const loadGithub = useCallback(async (force = false) => {
    setGithub('pending');
    setGithub(await opentig.github.status(force).then(githubCheck, () => 'error' as const));
  }, []);
  useEffect(() => {
    void loadAuthorship().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not read your Git identity.'));
    void loadGithub();
  }, [loadAuthorship, loadGithub]);
  // Settings may sign in to GitHub; check again when the window regains focus.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void loadGithub(true); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [loadGithub]);

  const identityDone = authorship !== null && !needsIdentity(authorship);
  const githubDone = github === 'ready' || githubSkipped;
  const done = 1 + Number(identityDone) + Number(githubDone);
  const identity = gitIdentityInputSchema.safeParse({ name, email });

  const saveIdentity = async (scope: 'global' | 'repository') => {
    if (!identity.success || !authorship || saving) return;
    setSaving(scope); setError('');
    try {
      if (scope === 'global') await opentig.app.setGlobalGitIdentity(identity.data);
      else await opentig.commits.setAuthorship(repository.id, { ...identity.data, expectedRevision: authorship.revision });
      await client.invalidateQueries({ queryKey: queryKeys.commitAuthorship(repository.id) });
      await loadAuthorship();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your Git identity.');
    } finally { setSaving(null); }
  };

  return <section className="onboarding-checklist" aria-labelledby="onboarding-checklist-title">
    <header>
      <h2 id="onboarding-checklist-title">{done === 3 ? 'You’re ready to commit' : 'Ready to commit'}</h2>
      <span>{done} of 3</span>
      <button type="button" aria-label="Dismiss getting started" onClick={onDismiss}><IconX /></button>
    </header>
    <div className="onboarding-meter" aria-hidden="true"><i style={{ width: `${done / 3 * 100}%` }} /></div>
    <ul>
      <Item done title="Repository opened" />
      <Item done={identityDone} pending={!authorship && !error} title="Who you commit as" detail={identityDone ? `${authorship!.author!.name} <${authorship!.author!.email}>` : 'Git needs a name and email for your commits.'}>
        {authorship && !identityDone && <form className="onboarding-identity" onSubmit={event => { event.preventDefault(); void saveIdentity(authorship.source === 'unset' || authorship.source === 'inferred' ? 'global' : 'repository'); }}>
          <input aria-label="Name" placeholder="Your name" value={name} maxLength={120} autoComplete="name" onChange={event => setName(event.target.value)} />
          <input aria-label="Email" type="email" placeholder="you@example.com" value={email} maxLength={254} autoComplete="email" onChange={event => setEmail(event.target.value)} />
          {authorship.blockers.map(blocker => <p key={blocker} className="onboarding-hint">{blocker}</p>)}
          <div>
            <Button type="button" variant="ghost" size="xs" disabled={!identity.success || !authorship.editable || Boolean(saving)} onClick={() => void saveIdentity('repository')}>{saving === 'repository' && <IconLoader4 className="animate-spin" />}This repository</Button>
            <Button type="submit" size="xs" disabled={!identity.success || Boolean(saving)}>{saving === 'global' && <IconLoader4 className="animate-spin" />}All repositories</Button>
          </div>
        </form>}
      </Item>
      <Item done={githubDone} pending={github === 'pending' && !githubSkipped} title="Connect GitHub for pull requests"
        detail={github === 'ready' ? 'GitHub CLI is signed in.' : githubSkipped ? 'Skipped. Set it up later in Settings → GitHub.' : github === 'missing' ? 'Install GitHub CLI, then run gh auth login.' : github === 'sign-in' ? 'Run gh auth login to sign in.' : 'GitHub CLI could not be checked.'}>
        {!githubDone && github !== 'pending' && <div className="onboarding-item-actions">
          <Button size="xs" variant="outline" onClick={() => onSettings('github')}>Set up</Button>
          <Button size="xs" variant="ghost" onClick={() => void loadGithub(true)}>Check again</Button>
          <Button size="xs" variant="ghost" onClick={() => setGithubSkipped(true)}>Skip</Button>
        </div>}
      </Item>
    </ul>
    {error && <p className="onboarding-error" role="alert">{error}</p>}
    {done === 3 && <Button size="sm" className="onboarding-checklist-done" onClick={onDismiss}>Done</Button>}
  </section>;
}

function Item({ done, pending = false, title, detail, children }: { done: boolean; pending?: boolean; title: string; detail?: string; children?: ReactNode }) {
  return <li data-done={done || undefined}>
    <span className="onboarding-check" aria-hidden="true">{pending ? <IconLoader4 className="animate-spin" /> : done && <IconCheck />}</span>
    <div><strong>{title}</strong><span className="sr-only">{done ? ', done' : ', to do'}</span>{detail && <small>{detail}</small>}{children}</div>
  </li>;
}
