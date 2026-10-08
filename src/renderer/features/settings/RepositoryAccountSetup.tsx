import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconLoader4 } from '@tabler/icons-react';
import type { RepositoryInfo } from '@shared/contracts';
import type { GitHubAccountSelection, GitHubAccountsStatus, GitHubRepositoryAccount } from '@shared/github-accounts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { SearchablePicker } from '@/components/SearchablePicker';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { publicationDestination, supportsManagedSetup } from '@/features/refs/publication-context';

const GLOBAL = '__global_default__';

export function RepositoryAccountSetup({ repository, isNew, onClose, onSettings }: {
  repository: RepositoryInfo; isNew: boolean; onClose(): void; onSettings(): void;
}) {
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const setup = useQuery({ queryKey: ['repository', repository.id, 'account-setup', attempt], gcTime: 0,
    queryFn: async () => {
      const [inventory, account] = await Promise.all([opentig.github.accountsStatus(true), opentig.github.repositoryAccount(repository.id, false)]);
      client.setQueryData(queryKeys.githubAccounts, inventory);
      return { inventory, account };
    }, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogPopup className="github-add-dialog github-setup-dialog">
      <DialogTitle>Choose access for {repository.name}</DialogTitle>
      <DialogDescription>Review the accounts before working with this repository’s remotes.</DialogDescription>
      {setup.isPending ? <><p className="github-setup-loading"><IconLoader4 className="animate-spin" />Reading accounts and destination…</p><Button variant="ghost" onClick={onClose}>Continue locally</Button></>
        : setup.data ? <SetupForm key={attempt} repository={repository} isNew={isNew} {...setup.data} saving={saving} setSaving={setSaving} onClose={onClose} onSettings={onSettings} onReload={() => setAttempt(value => value + 1)} />
          : <><p className="github-settings-notice" role="alert">Could not load repository access. You can still work locally.</p>
            <div className="github-add-actions"><Button variant="ghost" onClick={onClose}>Continue locally</Button><Button onClick={() => void setup.refetch()}>Retry</Button></div></>}
    </DialogPopup>
  </Dialog>;
}

function SetupForm({ repository, isNew, inventory, account, saving, setSaving, onClose, onSettings, onReload }: {
  repository: RepositoryInfo; isNew: boolean; inventory: GitHubAccountsStatus; account: GitHubRepositoryAccount;
  saving: boolean; setSaving(value: boolean): void; onClose(): void; onSettings(): void; onReload(): void;
}) {
  const client = useQueryClient();
  const compatible = supportsManagedSetup(account.access?.publication.urls ?? []);
  const existing = account.selection.mode === 'account' ? account.selection : null;
  const [choice, setChoice] = useState(() => existing?.useGlobalDefault ? GLOBAL : existing?.login ?? (inventory.defaultLogin ? GLOBAL : inventory.accounts.find(item => item.login === inventory.activeLogin && item.state === 'authenticated')?.login ?? inventory.accounts.find(item => item.state === 'authenticated')?.login ?? inventory.activeLogin ?? ''));
  const [both, setBoth] = useState(() => existing ? existing.gitMode === 'managed' : isNew && compatible);
  const [error, setError] = useState<string | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState(account.revision);
  const login = choice === GLOBAL ? inventory.defaultLogin : choice;
  const items = inventory.accounts.map(item => ({ value: item.login, label: `@${item.login}`, description: item.state === 'authenticated' ? 'Available account' : 'Reconnect this account in GitHub CLI' }));
  if (existing && !items.some(item => item.value === existing.login)) items.push({ value: existing.login, label: `@${existing.login}`, description: 'Saved account · reconnect to use it' });
  const save = async () => {
    if (!login || saving) return;
    setSaving(true); setError(null);
    try {
      const selection: GitHubAccountSelection = { mode: 'account', host: 'github.com', login,
        gitMode: both && compatible ? 'managed' : existing?.gitMode === 'managed' && !compatible ? 'managed' : 'external',
        ...(choice === GLOBAL ? { useGlobalDefault: true } : {}) };
      const saved = await opentig.github.setRepositoryAccount(repository.id, selection, reviewedRevision);
      setReviewedRevision(saved.revision);
      client.setQueryData<GitHubRepositoryAccount>(queryKeys.githubAccount(repository.id), previous => previous && previous.revision > saved.revision ? previous : saved);
      const checked = await opentig.github.repositoryAccount(repository.id, true);
      client.setQueryData<GitHubRepositoryAccount>(queryKeys.githubAccount(repository.id), previous => previous && previous.revision > checked.revision ? previous : checked);
      if (checked.revision !== saved.revision) {
        setError('The repository account changed during the check. Reload setup to review the current choice.');
      } else if (checked.state === 'error' || checked.access && [checked.access.identity, checked.access.api, checked.access.read].some(check => ['expired', 'inaccessible', 'offline'].includes(check.state))) {
        setError(checked.message || 'The choice was saved, but access could not be verified. Check the account in Settings or continue locally.');
      } else onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save repository access.'); }
    finally { setSaving(false); }
  };
  return <>
    <div className="github-setup-account"><label className="github-setup-label" htmlFor="setup-github-account">GitHub account</label>
      <SearchablePicker groups={[{ id: 'default', label: 'OpenTig default', items: [{ value: GLOBAL, label: inventory.defaultLogin ? `Global default · @${inventory.defaultLogin}` : 'Global default · not set', disabled: !inventory.defaultLogin }] }, { id: 'accounts', label: 'Saved accounts', items }]}
        value={choice} triggerId="setup-github-account" label="Account for this repository" triggerLabel={choice === GLOBAL ? `Global default · @${login}` : login ? `@${login}` : 'Choose an account'}
        placeholder="Search accounts…" size="default" align="start" disabled={saving} onValueChange={setChoice} />
    </div>
    <label className="github-setup-both"><input type="checkbox" checked={both && compatible} disabled={saving || !compatible} onChange={event => setBoth(event.target.checked)} />
      <span><strong>Use this account for Git too</strong><small>{compatible ? 'Authenticate GitHub HTTPS reads and pushes with the same account.' : 'This destination uses external authentication. SSH keys and other providers stay unchanged.'}</small></span>
    </label>
    <div className="github-push-destination github-setup-summary">
      <p>GitHub / PRs: <strong>{login ? `@${login}` : 'No account selected'}</strong></p>
      <p>Git: <strong>{both && compatible ? login ? `@${login} · OpenTig` : 'No account selected' : 'External authentication'}</strong></p>
      {account.access && <p>{publicationDestination(account.access.publication)}</p>}
    </div>
    <p className="github-settings-note">{choice === GLOBAL ? 'Follows the OpenTig default account. ' : ''}Shared across worktrees and connected clients. Commit authorship stays separate.</p>
    {(inventory.message || error) && <p className="github-settings-notice" role="alert">{error ?? inventory.message}</p>}
    <Button variant="link" size="sm" disabled={saving} onClick={onSettings}>Add an account or change the global default</Button>
    <div className="github-add-actions">
      <Button variant="ghost" disabled={saving} onClick={onClose}>Continue locally</Button>
      {error && <Button variant="outline" disabled={saving} onClick={onReload}>Reload setup</Button>}
      <Button disabled={saving || !login} onClick={() => void save()}>{saving && <IconLoader4 className="animate-spin" />}{saving ? 'Checking access…' : 'Save and continue'}</Button>
    </div>
  </>;
}
