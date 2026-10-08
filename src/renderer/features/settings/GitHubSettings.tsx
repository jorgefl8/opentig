import { Tabs } from '@base-ui/react/tabs';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconBrandGithub, IconCopy, IconGitBranch, IconLoader4, IconPlus, IconRefresh, IconSettings, IconUser } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { RepositoryInfo } from '@shared/contracts';
import type { GitHubAccountSelection, GitHubAccountsStatus, GitHubRepositoryAccount } from '@shared/github-accounts';
import { formatDateTime } from '@shared/date-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { SearchablePicker } from '@/components/SearchablePicker';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { RepositoryAccessStatus } from './RepositoryAccessStatus';
import { CommitAuthorshipDialog } from './CommitAuthorshipDialog';
import { authorshipSourceLabel } from './commit-authorship-copy';

export function GitHubSettings({ repository }: { repository: RepositoryInfo | null }) {
  const client = useQueryClient();
  const inventory = useQuery({ queryKey: queryKeys.githubAccounts, queryFn: () => opentig.github.accountsStatus(false), staleTime: Infinity });
  const context = useQuery({ queryKey: queryKeys.githubAccount(repository?.id ?? ''),
    queryFn: () => opentig.github.repositoryAccount(repository!.id, false), enabled: repository !== null, staleTime: Infinity });
  const authorship = useQuery({ queryKey: queryKeys.commitAuthorship(repository?.id ?? ''),
    queryFn: () => opentig.commits.authorship(repository!.id), enabled: repository !== null });
  const generations = useRef(new Map<string, number>());
  const [scope, setScope] = useState<'repository' | 'global'>(repository ? 'repository' : 'global');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [authorOpen, setAuthorOpen] = useState(false);
  useEffect(() => { setAuthorOpen(false); }, [repository?.id]);
  useEffect(() => opentig.events.onRepositoryChanged((id, scope) => {
    if (id === repository?.id && scope === 'unknown') void client.invalidateQueries({ queryKey: queryKeys.commitAuthorship(id) });
  }), [client, repository?.id]);
  const status = inventory.data;
  const account = context.data;
  const author = authorship.data;
  const selection = account?.selection.mode === 'account' ? account.selection.useGlobalDefault ? '__global_default__' : account.selection.login : 'auto';
  const accounts = status?.accounts ?? [];
  const selectable = accounts.map((item) => ({ value: item.login, label: `@${item.login}`,
    description: `${item.state === 'authenticated' ? 'Authenticated' : item.state === 'invalid' ? 'Credentials rejected' : 'Not verified'}${item.active ? ' · active in gh' : ''}`,
    icon: <IconBrandGithub /> }));
  if (selection !== 'auto' && selection !== '__global_default__' && !selectable.some((item) => item.value === selection)) {
    selectable.push({ value: selection, label: `@${selection}`, description: 'Not in the last checked accounts', icon: <IconBrandGithub /> });
  }
  if (status?.defaultLogin && !selectable.some(item => item.value === status.defaultLogin)) selectable.push({ value: status.defaultLogin, label: `@${status.defaultLogin}`, description: 'Default account · not in the last checked accounts', icon: <IconBrandGithub /> });
  const storeContext = (id: string, value: GitHubRepositoryAccount) => client.setQueryData<GitHubRepositoryAccount>(queryKeys.githubAccount(id), previous => previous && previous.revision > value.revision ? previous : value);
  const check = async (includeRepository = false): Promise<GitHubAccountsStatus | null> => {
    const target = includeRepository ? repository : null;
    const id = target?.id ?? '';
    const generation = (generations.current.get(id) ?? 0) + 1; generations.current.set(id, generation);
    setChecking(true);
    try {
      const next = await opentig.github.accountsStatus(true);
      client.setQueryData(queryKeys.githubAccounts, next);
      if (next.message || next.installationStatus !== 'available') throw new Error(next.message || 'GitHub CLI is unavailable.');
      if (target) {
        const value = await opentig.github.repositoryAccount(target.id, true);
        if (generations.current.get(id) === generation) storeContext(target.id, value);
        await client.invalidateQueries({ queryKey: queryKeys.commitAuthorship(target.id) });
      }
      return next;
    } catch (error) { sileo.error({ title: 'Could not check GitHub', description: messageOf(error) }); return null; }
    finally { setChecking(false); }
  };
  const choose = async (value: string, gitMode: 'external' | 'managed' = account?.selection.mode === 'account' ? account.selection.gitMode ?? 'external' : 'external') => {
    if (!repository || saving) return;
    const generation = (generations.current.get(repository.id) ?? 0) + 1; generations.current.set(repository.id, generation);
    setSaving(true);
    const next: GitHubAccountSelection = value === 'auto' ? { mode: 'auto' } : { mode: 'account', host: 'github.com', login: value === '__global_default__' ? status?.defaultLogin ?? '' : value, gitMode, ...(value === '__global_default__' ? { useGlobalDefault: true } : {}) };
    try {
      const saved = await opentig.github.setRepositoryAccount(repository.id, next);
      if (generations.current.get(repository.id) === generation) storeContext(repository.id, saved);
      const checked = await opentig.github.repositoryAccount(repository.id, true);
      if (generations.current.get(repository.id) === generation) storeContext(repository.id, checked);
    } catch (error) { sileo.error({ title: 'Could not save GitHub account', description: messageOf(error) }); }
    finally { setSaving(false); }
  };
  const managed = account?.selection.mode === 'account' && account.selection.gitMode === 'managed';
  const checkButton = <Button variant="outline" size="sm" onClick={() => void check(true)} disabled={checking || saving || inventory.isFetching}>
    {checking || saving ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}
    {checking || saving ? <ShimmeringText text="Checking…" /> : 'Check access'}
  </Button>;
  return <Tabs.Root className="github-settings" value={repository ? scope : 'global'} onValueChange={value => { if (value === 'repository' || value === 'global') setScope(value); }}>
    <Tabs.List className="github-scope-tabs" aria-label="GitHub settings scope">
      <Tabs.Tab value="repository" disabled={!repository}><IconGitBranch />This repository</Tabs.Tab>
      <Tabs.Tab value="global"><IconSettings />OpenTig</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="repository" className="github-scope-panel">
    {repository && <>
    <header className="github-repository-heading github-scope-heading">
      <IconGitBranch /><div><span className="github-settings-eyebrow">This repository</span><h2>{account?.nameWithOwner || repository.name}</h2>
        <p>Shared with its worktrees and connected clients.</p></div>
    </header>
    <section className="github-settings-section github-access-card" aria-label="Repository account and authentication">
      <div className="github-settings-row"><h3>Account for this repository</h3></div>
        <div className="github-account-picker"><label className="sr-only" htmlFor="github-account-choice">Account for GitHub operations</label>
          <SearchablePicker groups={[{ id: 'default', label: 'OpenTig default', items: [{ value: '__global_default__', label: status?.defaultLogin ? `Global default · @${status.defaultLogin}` : 'Global default · not set', description: 'Follow the default account in the OpenTig tab.', disabled: !status?.defaultLogin }] }, { id: 'accounts', label: 'Saved accounts', items: selectable }]}
            value={selection} onValueChange={(value) => void choose(value)} label="GitHub account for this repository" triggerId="github-account-choice"
            triggerLabel={selection === 'auto' ? 'Choose an account' : selection === '__global_default__' ? `Global default · @${account?.login ?? status?.defaultLogin}` : `@${selection}`} placeholder="Search accounts…" size="default" align="start"
            disabled={saving} />
        </div>
        <p className="github-settings-note">Used for GitHub and pull requests.</p>
        <Button variant="link" size="sm" className="github-manage-accounts" onClick={() => setScope('global')}>Manage accounts in OpenTig</Button>
        {selection === 'auto' && account?.login && <p className="github-settings-note">Currently @{account.login}. Choose an account to keep it pinned.</p>}
        {account?.state === 'error' && <p className="github-settings-notice" role="status">{account.message || 'This account is unavailable. Check access or choose another account.'}</p>}
        <fieldset className="github-git-mode" disabled={saving}>
          <legend>Git authentication</legend>
          <div className="github-git-mode-options">
            <label><input type="radio" name="git-authentication" value="external" checked={!managed} onChange={() => void choose(selection, 'external')} />
              <span><strong>Existing credentials</strong><small>Use saved Git credentials or SSH keys on the machine running OpenTig.</small></span>
            </label>
            <label><input type="radio" name="git-authentication" value="managed" checked={managed} disabled={selection === 'auto'} onChange={() => void choose(selection, 'managed')} />
              <span><strong>OpenTig</strong><small>Use the selected account for GitHub HTTPS.</small></span>
            </label>
          </div>
          <p className="github-settings-note">{managed ? 'SSH and other providers keep using the machine’s existing credentials.' : selection === 'auto' ? 'Git may use a different account. Choose an account above to enable OpenTig authentication.' : 'Git may use a different account. Choose OpenTig to use this account for GitHub HTTPS.'}</p>
        </fieldset>
        <div className="github-access-checks">
          <div className="github-settings-row"><h3>Access checks</h3>{checkButton}</div>
          {account?.access ? <RepositoryAccessStatus access={account.access} checking={checking || saving} />
            : <p className="github-settings-note">Check access to verify the account and repository permissions.</p>}
        </div>
      {context.error && <p className="github-settings-notice" role="alert">{messageOf(context.error)}</p>}
    </section>
    <section className="github-settings-section github-authorship-section">
      <div className="github-settings-row"><h3>Commit author</h3><Button variant="outline" size="sm" onClick={() => setAuthorOpen(true)} disabled={authorship.isPending || !author}>Edit authorship</Button></div>
      <p className="github-settings-note">Read from Git. Edits here apply only to this repository.</p>
      <div className="github-authorship-card">
        <IconUser /><div><strong>{author?.author?.name || (authorship.isPending ? 'Reading Git identity…' : 'Not configured')}</strong>
          <p>{author?.author?.email || 'Set a name and email before creating commits.'}</p>
          {author && <small>{authorshipSourceLabel(author.source)} · separate from your access account</small>}
          {author?.committer && (author.committer.name !== author.author?.name || author.committer.email !== author.author?.email) && <p className="github-authorship-committer">Committer: {author.committer.name} &lt;{author.committer.email}&gt;</p>}
        </div>
      </div>
      {author?.blockers.map((blocker) => <p className="github-settings-notice" key={blocker}>{blocker}</p>)}
      {authorship.error && <p className="github-settings-notice" role="alert">{messageOf(authorship.error)}</p>}
    </section>
    </>}
    </Tabs.Panel>
    <Tabs.Panel value="global" className="github-scope-panel">
    <header className="github-scope-heading">
      <IconSettings /><div><span className="github-settings-eyebrow">Instance-wide settings</span><h2>OpenTig</h2>
        <p>Shared by all clients connected to this instance.</p></div>
    </header>
    <section className="github-settings-section" aria-label="Global default account">
      <h3>Default account for OpenTig</h3>
      <div className="github-account-picker"><SearchablePicker
        groups={[{ id: 'accounts', label: 'Saved accounts', items: selectable.filter(item => item.value !== 'auto') }]}
        value={status?.defaultLogin ?? ''} triggerLabel={status?.defaultLogin ? `@${status.defaultLogin}` : 'Choose a default account'}
        label="Global default account" placeholder="Search accounts…" size="default" align="start" disabled={saving}
        onValueChange={(login) => {
          setSaving(true);
          void opentig.github.setDefaultAccount(login).then(async next => {
            client.setQueryData(queryKeys.githubAccounts, next);
            if (repository && account?.selection.mode === 'account' && account.selection.useGlobalDefault) await client.invalidateQueries({ queryKey: queryKeys.githubAccount(repository.id) });
          }).catch(error => sileo.error({ title: 'Could not save default account', description: messageOf(error) })).finally(() => setSaving(false));
        }} />
      </div>
      <p className="github-settings-note">Repositories set to Global default follow this account. Pinned accounts and the active gh account stay unchanged.</p>
    </section>
    <section className="github-settings-section github-global-accounts" aria-label="Accounts available to OpenTig">
      <div className="github-settings-row"><h3>Available accounts</h3><Button variant="outline" size="sm" onClick={() => setAddOpen(true)}><IconPlus />Add account</Button></div>
      <p className="github-settings-note">Accounts saved on the machine running OpenTig. Adding one makes it available to all repositories.</p>
      <Button variant="ghost" size="sm" className="github-refresh-accounts" onClick={() => void check()} disabled={checking || saving || inventory.isFetching}>
        {checking ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}{checking ? <ShimmeringText text="Checking…" /> : 'Refresh accounts'}
      </Button>
      {status?.message && <p className="github-settings-notice" role="status">{status.message}</p>}
      {inventory.error && <p className="github-settings-notice" role="alert">{messageOf(inventory.error)}</p>}
    <details className="github-saved-accounts">
      <summary>Saved accounts & GitHub CLI <span>{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}</span></summary>
      <div className="github-accounts-list">{accounts.map((item) => <div className="github-account-row" key={item.login}>
        <span className="github-account-avatar" aria-hidden="true">{item.login.slice(0, 2).toUpperCase()}</span>
        <div className="github-account-copy"><strong>@{item.login}</strong><small>{item.active ? 'Active in gh · global' : 'Saved in GitHub CLI'}</small></div>
        <div className="github-account-badges">{status?.defaultLogin === item.login && <Badge variant="secondary">OpenTig default</Badge>}
          <span className={`github-auth-state ${item.state}`}>{item.state === 'authenticated' ? 'Authenticated' : item.state === 'invalid' ? 'Credentials rejected' : 'Not verified'}</span></div>
      </div>)}</div>
      {!accounts.length && <p className="github-settings-note">{status?.checkedAt ? 'No saved accounts found. Add an account and check again.' : 'Refresh accounts to list saved accounts.'}</p>}
      <div className="github-cli-section">
        <strong className="github-cli-version"><IconBrandGithub />{status?.version || 'GitHub CLI'}<Badge variant="outline">{installationLabel(status)}</Badge></strong>
        <p className="github-settings-note">{status?.checkedAt ? `Last checked: ${formatDateTime(status.checkedAt, { seconds: true })}` : 'Not checked yet.'}</p>
        <p className="github-global-account">Active globally in gh: <strong>{status?.activeLogin ? `@${status.activeLogin}` : 'Not verified'}</strong></p>
        {status?.environment.present && <p className="github-settings-notice">Backend environment credentials: {status.environment.login ? `@${status.environment.login}` : 'identity not verified'}. Unpinned HTTPS accounts may use these credentials.</p>}
        <p className="github-settings-note">Opening Settings uses saved results. Use Refresh accounts to update them.</p>
      </div>
    </details>
    </section>
    </Tabs.Panel>
    {repository && <CommitAuthorshipDialog key={repository.id} repository={repository} open={authorOpen} onOpenChange={setAuthorOpen} />}
    <AddGitHubAccountDialog open={addOpen} onOpenChange={setAddOpen} status={status} onCheck={() => check()} checking={checking} />
  </Tabs.Root>;
}

function AddGitHubAccountDialog({ open, onOpenChange, status, onCheck, checking }: {
  open: boolean; onOpenChange(open: boolean): void; status: GitHubAccountsStatus | undefined; onCheck(): Promise<GitHubAccountsStatus | null>; checking: boolean;
}) {
  const [step, setStep] = useState(0);
  const [previous, setPrevious] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const added = status?.accounts.filter((account) => !known.includes(account.login)) ?? [];
  const copy = async (command: string) => {
    try { await writeClipboardText(command); sileo.success({ title: 'Command copied' }); }
    catch (error) { sileo.error({ title: 'Could not copy command', description: messageOf(error) }); }
  };
  const close = (value: boolean) => { if (!value) setStep(0); onOpenChange(value); };
  return <Dialog open={open} onOpenChange={close}><DialogPopup className="github-add-dialog">
    <DialogTitle>{step === 2 ? 'Check the updated accounts' : 'Add a GitHub account'}</DialogTitle>
    <DialogDescription>Use the official GitHub CLI browser login on the machine running OpenTig.</DialogDescription>
    <div className="github-add-steps" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((item) => <span key={item} className={item <= step ? 'active' : ''} />)}</div>
    {step === 0 ? <>
      <p>Your saved accounts are kept. There is no need to log out first.</p>
      <p className="github-settings-notice"><strong>GitHub CLI activates the account you add.</strong> This can affect other terminals and HTTPS repositories using Automatic. OpenTig will not switch the global account back automatically.</p>
      <p>Keep Git credential setup and SSH key management unchanged during login. Your account selection in OpenTig is saved separately.</p>
    </> : step === 1 ? <>
      <div className="github-login-command"><code>gh auth login --hostname github.com --web --skip-ssh-key</code><Button variant="ghost" size="icon-sm" aria-label="Copy GitHub login command" onClick={() => void copy('gh auth login --hostname github.com --web --skip-ssh-key')}><IconCopy /></Button></div>
      <ol><li>Run the command in a terminal on the backend host.</li><li>Keep your existing Git protocol. If gh offers to authenticate Git, answer <strong>No</strong>. Skip creating or uploading SSH keys.</li><li>Verify the intended account in your browser before authorising GitHub CLI.</li><li>Return here and check the accounts. If backend token environment variables prevent login, manage them in that terminal; OpenTig does not edit them.</li></ol>
      {previous && <p className="github-settings-note">Previously checked active account: @{previous}.</p>}
    </> : <>
      <p>{added.length ? `Newly detected accounts: ${added.map((account) => `@${account.login}`).join(', ')}.` : 'No new saved account was detected. You can check again after finishing the login.'}</p>
      <p className="github-settings-notice">Last checked active account: {status?.activeLogin ? `@${status.activeLogin}` : 'not available'}. Existing accounts and explicit repository selections are preserved.</p>
      {previous && previous !== status?.activeLogin && <><p>To restore the previous global account, run this command voluntarily in your terminal:</p>
        <div className="github-login-command"><code>gh auth switch --hostname github.com --user {previous}</code><Button variant="ghost" size="icon-sm" aria-label="Copy restore global account command" onClick={() => void copy(`gh auth switch --hostname github.com --user ${previous}`)}><IconCopy /></Button></div></>}
      <p className="github-settings-note">These commands are only copied. OpenTig never executes login, logout or account switching.</p>
    </>}
    <div className="github-add-actions"><Button variant="ghost" onClick={() => close(false)}>{step === 2 ? 'Done' : 'Cancel'}</Button>
      {step === 0 ? <Button onClick={() => { setPrevious(status?.activeLogin ?? null); setKnown(status?.accounts.map((account) => account.login) ?? []); setStep(1); }}>View instructions</Button>
        : <Button onClick={() => void onCheck().then((next) => { if (next?.accounts.some(item => item.state === 'authenticated' && !known.includes(item.login))) setStep(2); else if (next) sileo.error({ title: 'No new authenticated account detected', description: 'Finish the login or reconnect the account, then check again. Your repository choice is unchanged.' }); })} disabled={checking}>{checking && <IconLoader4 className="animate-spin" />}{step === 1 ? 'I have finished · check accounts' : 'Check again'}</Button>}
    </div>
  </DialogPopup></Dialog>;
}

function installationLabel(status: GitHubAccountsStatus | undefined): string {
  switch (status?.installationStatus) {
    case 'available': return 'Available';
    case 'not-found': return 'Not installed';
    case 'not-executable': return 'Cannot run';
    case 'incompatible': return 'Update required';
    case 'inspection-failed': return 'Check failed';
    default: return 'Not checked';
  }
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'The request could not be completed.'; }
