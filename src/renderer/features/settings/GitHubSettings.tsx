import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconBrandGithub, IconCheck, IconCopy, IconGitBranch, IconLoader4, IconPlus, IconRefresh, IconUser } from '@tabler/icons-react';
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

function githubAccountReason(account: GitHubRepositoryAccount): string {
  if (account.message) return account.message;
  if (account.source === 'explicit') return 'Explicit choice for this repository';
  if (account.source === 'ssh') return 'Automatic · verified SSH identity';
  if (account.source === 'environment') return 'Automatic · backend environment credentials';
  if (account.source === 'global') return 'Automatic · active GitHub CLI account';
  return 'Check status to verify the repository account.';
}

export function GitHubSettings({ repository }: { repository: RepositoryInfo | null }) {
  const client = useQueryClient();
  const inventory = useQuery({ queryKey: queryKeys.githubAccounts, queryFn: () => opentig.github.accountsStatus(false), staleTime: Infinity });
  const context = useQuery({ queryKey: queryKeys.githubAccount(repository?.id ?? ''),
    queryFn: () => opentig.github.repositoryAccount(repository!.id, false), enabled: repository !== null, staleTime: Infinity });
  const authorship = useQuery({ queryKey: queryKeys.commitAuthorship(repository?.id ?? ''),
    queryFn: () => opentig.commits.authorship(repository!.id), enabled: repository !== null });
  const generations = useRef(new Map<string, number>());
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
  const selection = account?.selection.mode === 'account' ? account.selection.login : 'auto';
  const accounts = status?.accounts ?? [];
  const selectable = accounts.map((item) => ({ value: item.login, label: `@${item.login}`,
    description: `${item.state === 'authenticated' ? 'Authenticated' : item.state === 'invalid' ? 'Credentials rejected' : 'Not verified'}${item.active ? ' · active in gh' : ''}`,
    icon: <IconBrandGithub /> }));
  if (selection !== 'auto' && !selectable.some((item) => item.value === selection)) {
    selectable.push({ value: selection, label: `@${selection}`, description: 'Not in the last checked accounts', icon: <IconBrandGithub /> });
  }
  const storeContext = (id: string, value: GitHubRepositoryAccount) => client.setQueryData<GitHubRepositoryAccount>(queryKeys.githubAccount(id), previous => previous && previous.revision > value.revision ? previous : value);
  const check = async (): Promise<GitHubAccountsStatus | null> => {
    const id = repository?.id ?? '';
    const generation = (generations.current.get(id) ?? 0) + 1; generations.current.set(id, generation);
    setChecking(true);
    try {
      const next = await opentig.github.accountsStatus(true);
      client.setQueryData(queryKeys.githubAccounts, next);
      if (next.message || next.installationStatus !== 'available') throw new Error(next.message || 'GitHub CLI is unavailable.');
      if (repository) {
        const value = await opentig.github.repositoryAccount(repository.id, true);
        if (generations.current.get(id) === generation) storeContext(repository.id, value);
        await client.invalidateQueries({ queryKey: queryKeys.commitAuthorship(repository.id) });
      }
      return next;
    } catch (error) { sileo.error({ title: 'Could not check GitHub', description: messageOf(error) }); return null; }
    finally { setChecking(false); }
  };
  const choose = async (value: string, gitMode: 'external' | 'managed' = account?.selection.mode === 'account' ? account.selection.gitMode ?? 'external' : 'external') => {
    if (!repository || saving) return;
    const generation = (generations.current.get(repository.id) ?? 0) + 1; generations.current.set(repository.id, generation);
    setSaving(true);
    const next: GitHubAccountSelection = value === 'auto' ? { mode: 'auto' } : { mode: 'account', host: 'github.com', login: value, gitMode };
    try {
      const saved = await opentig.github.setRepositoryAccount(repository.id, next);
      if (generations.current.get(repository.id) === generation) storeContext(repository.id, saved);
      const checked = await opentig.github.repositoryAccount(repository.id, true);
      if (generations.current.get(repository.id) === generation) storeContext(repository.id, checked);
    } catch (error) { sileo.error({ title: 'Could not save GitHub account', description: messageOf(error) }); }
    finally { setSaving(false); }
  };
  const accountLabel = account?.state === 'ready' && account.login ? `@${account.login}`
    : account?.state === 'error' ? account.login ? `@${account.login} unavailable` : 'Choose or verify an account'
      : account?.nameWithOwner ? 'Not verified yet' : repository ? 'No GitHub remote' : 'No repository open';
  return <div className="github-settings">
    {repository && <section className="github-repository-summary" aria-label="Current repository identities">
      <span className="github-settings-eyebrow">Current repository</span>
      <h2><IconGitBranch />{account?.nameWithOwner || repository.name}</h2>
      <div className="github-identity-summary">
        <div className={`github-effective-account ${account?.state ?? 'unchecked'}`}>
          <span>GitHub account</span><strong>{accountLabel}</strong>
          <p>{account ? githubAccountReason(account) : 'Reading saved repository selection…'}</p>
        </div>
        <div className="github-author-summary"><span>Author of the next commit</span>
          <strong>{author?.author?.name || (authorship.isPending ? 'Reading Git identity…' : author ? 'Not configured' : 'Could not read Git identity')}</strong>
          {author?.author?.email && <p>{author.author.email}</p>}
          {author && <small>{authorshipSourceLabel(author.source)}</small>}
        </div>
      </div>
    </section>}
    <section className="github-settings-section">
      <div className="github-settings-row"><h3>Account for this repository</h3></div>
      {repository ? <>
        <div className="github-account-picker"><label className="sr-only" htmlFor="github-account-choice">Account for GitHub operations</label>
          <SearchablePicker groups={[{ id: 'accounts', label: 'Saved accounts', items: selectable }]}
            value={selection} onValueChange={(value) => void choose(value)} label="GitHub account for this repository" triggerId="github-account-choice"
            triggerLabel={selection === 'auto' ? 'Choose an account' : `@${selection}`} placeholder="Search accounts…" size="default" align="start"
            disabled={saving} />
        </div>
        {account?.nameWithOwner ? <><p className="github-settings-note">The selected account reads and creates PRs. Choose whether it also authenticates GitHub HTTPS operations.</p>
          <p className={selection === 'auto' ? 'github-settings-note' : 'github-selection-saved'}>{selection !== 'auto' && <IconCheck />}{saving ? 'Saving and verifying…' : selection === 'auto' ? 'Choose an account to save a choice shared by connected clients and worktrees.' : 'Selection shared by connected clients and worktrees'}</p></>
          : <p className="github-settings-note">No supported GitHub PR destination was detected. The Git mode still applies to compatible HTTPS remotes. Commit authorship remains independent.</p>}
        <div className="github-settings-row"><strong>Git authentication</strong>
          <Button variant="outline" size="sm" disabled={saving || selection === 'auto'} onClick={() => void choose(selection, account?.selection.mode === 'account' && account.selection.gitMode === 'managed' ? 'external' : 'managed')}>
            {account?.selection.mode === 'account' && account.selection.gitMode === 'managed' ? 'Use external authentication' : 'Use this account for Git HTTPS'}
          </Button>
        </div>
        <p className="github-settings-note">{account?.selection.mode === 'account' && account.selection.gitMode === 'managed'
          ? 'Managed by OpenTig for github.com HTTPS. SSH keys and other transports remain external.'
          : 'External authentication. GitHub and Git may use different credentials. Existing repositories keep this mode until you opt in.'}</p>
        {account?.access && <RepositoryAccessStatus access={account.access} checking={checking || saving} />}
        {account?.state === 'error' && <p className="github-settings-notice" role="status">{account.message || 'The selected account is unavailable. Check status or choose another saved account.'}</p>}
      </> : <p className="github-settings-note">Open a repository to choose its GitHub account and review its commit authorship.</p>}
      <p className="github-global-account">Active globally in gh: <strong>{status?.activeLogin ? `@${status.activeLogin}` : 'Not verified'}</strong></p>
      {status?.environment.present && <p className="github-settings-notice">Backend environment credentials: {status.environment.login ? `@${status.environment.login}` : 'identity not verified'}. They override the global gh account in Automatic mode for HTTPS; explicit and verified SSH accounts keep their saved credentials.</p>}
      {context.error && <p className="github-settings-notice" role="alert">{messageOf(context.error)}</p>}
    </section>
    {repository && <section className="github-settings-section">
      <div className="github-settings-row"><h3>Commit authorship</h3><Button variant="outline" size="sm" onClick={() => setAuthorOpen(true)} disabled={authorship.isPending || !author}>Edit authorship</Button></div>
      <div className="github-authorship-card">
        <IconUser /><div><strong>{author?.author?.name || 'Not configured'}</strong>
          <p>{author?.author?.email || 'Set a name and email before creating commits.'}</p>
          {author && <small>{authorshipSourceLabel(author.source)} · independent of gh</small>}
          {author?.committer && (author.committer.name !== author.author?.name || author.committer.email !== author.author?.email) && <p className="github-authorship-committer">Committer: {author.committer.name} &lt;{author.committer.email}&gt;</p>}
        </div>
      </div>
      {author?.blockers.map((blocker) => <p className="github-settings-notice" key={blocker}>{blocker}</p>)}
      {authorship.error && <p className="github-settings-notice" role="alert">{messageOf(authorship.error)}</p>}
      <p className="github-settings-note">Edit the effective Git name and email explicitly. Changing the GitHub account never changes authorship automatically.</p>
    </section>}
    <section className="github-settings-section github-accounts-section">
      <div className="github-settings-row"><h3>Available accounts</h3><Button variant="outline" size="sm" onClick={() => setAddOpen(true)}><IconPlus />Add account</Button></div>
      <div className="github-accounts-list">{accounts.map((item) => <div className="github-account-row" key={item.login}>
        <span className="github-account-avatar" aria-hidden="true">{item.login.slice(0, 2).toUpperCase()}</span>
        <div className="github-account-copy"><strong>@{item.login}</strong><small>{item.active ? 'Active in gh · global' : 'Saved in GitHub CLI'}</small></div>
        <div className="github-account-badges">{account?.state === 'ready' && account.login?.toLowerCase() === item.login.toLowerCase() && <Badge variant="secondary">This repository</Badge>}
          <span className={`github-auth-state ${item.state}`}>{item.state === 'authenticated' ? 'Authenticated' : item.state === 'invalid' ? 'Credentials rejected' : 'Not verified'}</span></div>
      </div>)}</div>
      {!accounts.length && <p className="github-settings-note">{status?.checkedAt ? 'No saved accounts were available in the last check. Add an account on the backend host and check again.' : 'Check status to list the accounts saved in GitHub CLI.'}</p>}
    </section>
    <section className="github-cli-section">
      <div className="github-settings-row"><div><strong className="github-cli-version"><IconBrandGithub />{status?.version || 'GitHub CLI'}<Badge variant="outline">{installationLabel(status)}</Badge></strong>
        <p className="github-settings-note">{status?.checkedAt ? `Last checked: ${formatDateTime(status.checkedAt, { seconds: true })}` : 'Status has not been checked yet.'}</p></div>
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking || inventory.isFetching}>{checking ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}{checking ? <ShimmeringText text="Checking…" /> : 'Check status'}</Button>
      </div>
      <p className="github-settings-note">Saved results are reused. Opening Settings does not check GitHub.</p>
      {status?.message && <p className="github-settings-notice" role="status">{status.message}</p>}
      {inventory.error && <p className="github-settings-notice" role="alert">{messageOf(inventory.error)}</p>}
    </section>
    {repository && <CommitAuthorshipDialog key={repository.id} repository={repository} open={authorOpen} onOpenChange={setAuthorOpen} />}
    <AddGitHubAccountDialog open={addOpen} onOpenChange={setAddOpen} status={status} onCheck={check} checking={checking} />
  </div>;
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
