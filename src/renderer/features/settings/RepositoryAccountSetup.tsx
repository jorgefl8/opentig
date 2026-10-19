import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconLoader4 } from '@tabler/icons-react';
import type { RepositoryInfo } from '@shared/contracts';
import type { GitHubAccountSelection, GitHubAccountsStatus, GitHubRepositoryAccount } from '@shared/github-accounts';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { SearchablePicker } from '@/components/SearchablePicker';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { GitHubSettings } from './GitHubSettings';
import { publicationDestination } from '@/features/refs/publication-context';
import { gitCredentialsLocation } from './github-access-copy';


export function RepositoryAccountSetup({ repository, onClose, onAdded }: {
  repository: RepositoryInfo; onClose(): void; onAdded(repository: RepositoryInfo): void;
}) {
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setup = useQuery({ queryKey: ['repository', repository.id, 'account-setup', attempt], gcTime: 0,
    queryFn: async () => {
      const [inventory, account] = await Promise.all([opentig.github.accountsStatus(true), opentig.github.repositoryAccount(repository.id, false)]);
      client.setQueryData(queryKeys.githubAccounts, inventory);
      return { inventory, account };
    }, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  return <><Dialog open onOpenChange={open => { if (!open && !saving && !settingsOpen) onClose(); }}>
    <DialogPopup className="github-add-dialog github-setup-dialog">
      <DialogTitle>Choose access for {repository.name}</DialogTitle>
      <DialogDescription>Review access to finish adding this repository. Cancel leaves your repositories unchanged.</DialogDescription>
      {setup.isPending ? <><p className="github-setup-loading" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /><ShimmeringText text="Reading accounts and destination…" /></p><Button variant="ghost" onClick={onClose}>Cancel</Button></>
        : setup.data ? <SetupForm key={attempt} repository={repository} {...setup.data} saving={saving} setSaving={setSaving} onClose={onClose} onAdded={onAdded} onSettings={() => setSettingsOpen(true)} onReload={() => setAttempt(value => value + 1)} />
          : <><p className="github-settings-notice" role="alert">Could not load repository access. Retry to finish adding this repository.</p>
            <div className="github-add-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void setup.refetch()}>Retry</Button></div></>}
    </DialogPopup>
  </Dialog>
    <Dialog open={settingsOpen} onOpenChange={open => { setSettingsOpen(open); if (!open) void setup.refetch(); }}>
      <DialogPopup className="github-add-dialog github-setup-dialog">
        <DialogTitle>GitHub accounts</DialogTitle>
        <DialogDescription>Manage connected accounts and the suggestion for new repositories.</DialogDescription>
        {settingsOpen && <GitHubSettings repository={null} />}
        <Button onClick={() => { setSettingsOpen(false); void setup.refetch(); }}>Back to repository setup</Button>
      </DialogPopup>
    </Dialog>
  </>;
}

function SetupForm({ repository, inventory, account, saving, setSaving, onClose, onAdded, onSettings, onReload }: {
  repository: RepositoryInfo; inventory: GitHubAccountsStatus; account: GitHubRepositoryAccount;
  saving: boolean; setSaving(value: boolean): void; onClose(): void; onAdded(repository: RepositoryInfo): void; onSettings(): void; onReload(): void;
}) {
  const client = useQueryClient();
  const [choice, setChoice] = useState(() => account.selection.mode === 'account' ? account.selection.login : account.selection.mode);
  const [error, setError] = useState<string | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState(account.revision);
  const external = choice === 'git';
  const login = choice === 'default' ? inventory.defaultLogin ?? null : external ? null : choice;
  const items = inventory.accounts.map(item => ({ value: item.login, label: `@${item.login}`, description: item.state === 'authenticated' ? item.login === inventory.defaultLogin ? 'Default account' : 'Connected account' : 'Reconnect this account in GitHub CLI' }));
  if (account.selection.mode === 'account' && !items.some(item => item.value === choice)) items.push({ value: choice, label: `@${choice}`, description: 'Saved account · reconnect to use it' });
  const save = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const selection: GitHubAccountSelection = choice === 'default' ? { mode: 'default' } : external ? { mode: 'git' } : { mode: 'account', host: 'github.com', login: choice };
      const saved = await opentig.github.setRepositoryAccount(repository.id, selection, reviewedRevision);
      setReviewedRevision(saved.revision);
      client.setQueryData<GitHubRepositoryAccount>(queryKeys.githubAccount(repository.id), previous => previous && previous.revision > saved.revision ? previous : saved);
      const checked = !login ? saved : await opentig.github.repositoryAccount(repository.id, true);
      client.setQueryData<GitHubRepositoryAccount>(queryKeys.githubAccount(repository.id), previous => previous && previous.revision > checked.revision ? previous : checked);
      if (checked.revision !== saved.revision) {
        setError('The repository account changed during the check. Reload setup to review the current choice.');
      } else if (login && (checked.state !== 'ready' || checked.access && [checked.access.identity, checked.access.api, checked.access.read].some(check => ['expired', 'inaccessible', 'offline'].includes(check.state)))) {
        setError(checked.message || 'The choice was saved, but access could not be verified. Reconnect the account or choose another one.');
      } else onAdded(await opentig.repository.completeSetup(repository.id, checked.revision));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save repository access.'); }
    finally { setSaving(false); }
  };
  return <>
    <div className="github-setup-account"><label className="github-setup-label" htmlFor="setup-github-account">GitHub account</label>
      <SearchablePicker groups={[{ id: 'default', label: 'Default', items: [{ value: 'default', label: inventory.defaultLogin ? `Default · @${inventory.defaultLogin}` : 'Default account', description: inventory.defaultLogin ? 'Follows the default if you change it' : 'No default account yet · uses Git’s own credentials' }] },
        { id: 'accounts', label: 'Connected accounts', items },
        { id: 'git', label: 'Advanced', items: [{ value: 'git', label: 'Git’s own credentials', description: `Credential helper or SSH key on ${gitCredentialsLocation()}` }] }]}
        value={choice} triggerId="setup-github-account" label="Account for this repository" triggerLabel={external ? 'Git’s own credentials' : choice === 'default' ? inventory.defaultLogin ? `Default · @${inventory.defaultLogin}` : 'Default account' : `@${choice}`}
        placeholder="Search accounts…" size="default" align="start" disabled={saving} onValueChange={setChoice} />
    </div>
    <div className="github-push-destination github-setup-summary">
      <p>Pull requests, fetch and push: <strong>{login ? `@${login}` : 'Git’s own credentials · account unverified'}</strong></p>
      {account.access && <p>{publicationDestination(account.access.publication)}</p>}
    </div>
    <p className="github-settings-note">Saved on the server for this repository and its worktrees. SSH remotes keep using your SSH key. Commit authorship stays separate.</p>
    {(inventory.message || error) && <p className="github-settings-notice" role="alert">{error ?? inventory.message}</p>}
    <Button variant="link" size="sm" disabled={saving} onClick={onSettings}>Manage connected accounts</Button>
    <div className="github-add-actions">
      <Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
      {error && <Button variant="outline" disabled={saving} onClick={onReload}>Reload setup</Button>}
      <Button disabled={saving} onClick={() => void save()}>{saving && <IconLoader4 className="animate-spin" />}{saving ? <ShimmeringText text="Checking access…" /> : 'Add repository'}</Button>
    </div>
  </>;
}
