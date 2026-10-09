import { Tabs } from '@base-ui/react/tabs';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBrandGithub, IconCheck, IconCopy, IconGitBranch, IconLoader4, IconPlus, IconRefresh,
  IconShieldCheck, IconUser, IconUsers,
} from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { RepositoryInfo } from '@shared/contracts';
import type { GitHubAccountSelection, GitHubAccountsStatus, GitHubRepositoryAccount } from '@shared/github-accounts';
import { formatDateTime } from '@shared/date-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchablePicker } from '@/components/SearchablePicker';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { RepositoryAccessStatus, CopyAccessDiagnostics } from './RepositoryAccessStatus';
import { CommitAuthorshipDialog } from './CommitAuthorshipDialog';
import { authorshipSourceLabel } from './commit-authorship-copy';
import { gitCredentialsLocation, gitHttpsModeLabel, gitHttpsOutcome } from './github-access-copy';
import { publicationDestination, supportsManagedSetup } from '@/features/refs/publication-context';

export function GitHubSettings({ repository }: { repository: RepositoryInfo | null }) {
  const client = useQueryClient();
  const id = useId();
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
  const [reconnectLogin, setReconnectLogin] = useState<string | null>(null);
  const [authorOpen, setAuthorOpen] = useState(false);
  useEffect(() => { setAuthorOpen(false); }, [repository?.id]);
  useEffect(() => opentig.events.onRepositoryChanged((id, scope) => {
    if (id === repository?.id && (scope === 'unknown' || scope === 'refs')) {
      void client.invalidateQueries({ queryKey: queryKeys.commitAuthorship(id) });
      void client.invalidateQueries({ queryKey: queryKeys.githubAccount(id) });
    }
  }), [client, repository?.id]);
  const status = inventory.data;
  const account = context.data;
  const author = authorship.data;
  const selection = account?.selection.mode === 'account' ? account.selection.useGlobalDefault ? '__global_default__' : account.selection.login : 'auto';
  const accounts = status?.accounts ?? [];
  const selectable = accounts.map((item) => ({ value: item.login, label: `@${item.login}`,
    description: item.state === 'authenticated' ? 'Connected account' : item.state === 'invalid' ? 'Reconnect this account' : 'Not checked',
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
  const compatible = supportsManagedSetup(account?.access?.publication.urls ?? []);
  const choose = async (value: string, gitMode: 'external' | 'managed' = account?.selection.mode === 'account' ? account.selection.gitMode ?? 'external' : compatible ? 'managed' : 'external') => {
    if (!repository || saving) return;
    const generation = (generations.current.get(repository.id) ?? 0) + 1; generations.current.set(repository.id, generation);
    setSaving(true);
    const next: GitHubAccountSelection = value === 'auto' ? { mode: 'auto' } : { mode: 'account', host: 'github.com', login: value === '__global_default__' ? status?.defaultLogin ?? '' : value, gitMode, ...(value === '__global_default__' ? { useGlobalDefault: true } : {}) };
    try {
      const saved = await opentig.github.setRepositoryAccount(repository.id, next, account?.revision);
      if (generations.current.get(repository.id) === generation) storeContext(repository.id, saved);
      const checked = await opentig.github.repositoryAccount(repository.id, true);
      if (generations.current.get(repository.id) === generation) storeContext(repository.id, checked);
    } catch (error) { sileo.error({ title: 'Could not save GitHub account', description: messageOf(error) }); }
    finally { setSaving(false); }
  };
  const managed = account?.selection.mode === 'account' && account.selection.gitMode === 'managed' && (account.access ? account.access.publication.mode === 'managed' : true);
  const pinnedLogin = account?.selection.mode !== 'account' ? null
    : account.selection.useGlobalDefault ? account.login || status?.defaultLogin || account.selection.login || null
      : account.selection.login || account.login || null;
  const repositoryAccountLabel = pinnedLogin ? `Repository account · @${pinnedLogin}` : 'Repository account';
  const gitAuthenticationLabel = managed ? repositoryAccountLabel : 'Existing Git credentials';
  const busy = checking || saving || inventory.isFetching;
  const checkButton = <Button variant="outline" size="sm" onClick={() => void check(true)} disabled={busy}>
    {checking || saving ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}
    {checking || saving ? <ShimmeringText text="Checking…" /> : 'Check access'}
  </Button>;
  const repoName = account?.nameWithOwner?.replace(/\.git$/, '') || '';
  const publication = account?.access?.publication;
  const destination = publication ? publicationDestination(publication) : 'Not read yet';
  const targetBranch = publication?.targetRef?.replace(/^refs\/heads\//, '');
  const branchLabel = publication?.branch && targetBranch && publication.branch !== targetBranch
    ? `${publication.branch} → ${targetBranch}` : targetBranch || publication?.branch || 'No branch';
  const separatePrDestination = repoName && destination.split(' · ')[0] !== repoName;

  return <Tabs.Root className="github-settings" value={repository ? scope : 'global'} onValueChange={value => { if (value === 'repository' || value === 'global') setScope(value); }}>
    <div className="github-settings-content">
    <Tabs.List className="github-scope-tabs" aria-label="GitHub settings scope">
      <Tabs.Tab value="repository" disabled={!repository}><IconGitBranch />This repository</Tabs.Tab>
      <Tabs.Tab value="global"><IconUsers />Accounts</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="repository" className="github-scope-panel">
    {repository && <>
    <header className="github-repository-heading github-scope-heading">
      <IconGitBranch aria-hidden="true" /><div>
        <h2>{repository.name}</h2>
        <p>Saved on the server for this repository, its worktrees and all connected clients.</p>
      </div>
    </header>
    {context.isPending ? <p role="status" className="github-settings-note"><ShimmeringText text="Reading repository configuration…" /></p>
      : !account ? <p role="alert" className="github-settings-notice">{messageOf(context.error)}</p> : <>
    <div className="github-access-card">
    <section className="settings-general-group" aria-labelledby={`${id}-account`}>
      <h3 id={`${id}-account`}><IconBrandGithub aria-hidden="true" />Account</h3>
      <SettingRow label="Account for this repository" description={managed ? "Used for GitHub, pull requests, fetch, pull and push over HTTPS." : "Used for GitHub and pull requests."}>
        <div className="github-account-picker">
          <label className="sr-only" htmlFor="github-account-choice">Account for GitHub operations</label>
          <SearchablePicker groups={[{ id: 'accounts', label: 'Connected accounts', items: selectable }, ...(selection === '__global_default__' ? [{ id: 'default', label: 'Existing shared default', items: [{ value: '__global_default__', label: `Following default · @${status?.defaultLogin}`, description: 'Changes when the shared default changes.' }] }] : [])]}
            value={selection} onValueChange={(value) => void choose(value)} label="GitHub account for this repository" triggerId="github-account-choice"
            triggerLabel={selection === 'auto' ? 'Choose an account' : selection === '__global_default__' ? `Following default · @${account?.login ?? status?.defaultLogin}` : `@${selection}`} placeholder="Search accounts…" size="sm" align="end"
            triggerClassName="github-account-select" disabled={saving} />
        </div>
      </SettingRow>
      <div className="settings-general-help">
        {selection === 'auto' && account?.login ? <span>Currently @{account.login} from existing configuration. Choose an account to keep it fixed for this repository.</span> : <span>{selection === '__global_default__' ? 'This repository follows the shared default. Choose an account to keep its own selection.' : 'Changing this account keeps the destination and commit author unchanged.'}</span>}
        <button type="button" className="github-manage-accounts" onClick={() => setScope('global')}>Manage accounts</button>
      </div>
      {account?.state === 'error' && <p className="github-settings-notice" role="status">{account.message || 'This account is unavailable. Check access or choose another account.'}</p>}
    </section>
      {!managed && <><div className="github-git-summary">
        <p>GitHub / PRs: <strong>{account?.login ? `@${account.login}` : pinnedLogin ? `@${pinnedLogin}` : 'No account verified'}</strong></p>
        <p>Fetch / push: <strong>{gitHttpsModeLabel(managed ? 'managed' : 'external', pinnedLogin)}</strong></p>
      </div>
      <p className="github-settings-note">{gitHttpsOutcome({ managed, login: pinnedLogin, compatible: account?.access ? compatible : true })}{!managed && selection === 'auto' && compatible ? ' Choose an account above to use it for Git HTTPS too.' : ''}</p></>}
    <section className="settings-general-group github-authorship-section" aria-labelledby={`${id}-author`}>
      <h3 id={`${id}-author`}><IconUser aria-hidden="true" />Commit author</h3>
      <div className="settings-general-row">
        <div className="github-authorship-card">
          <IconUser aria-hidden="true" /><div>
            <strong>{author?.author?.name || (authorship.isPending ? <ShimmeringText text="Reading Git identity…" /> : 'Not configured')}</strong>
            <p>{author?.author?.email || 'Set a name and email before creating commits.'}</p>
            {author && <small>{authorshipSourceLabel(author.source)} · separate from your access account</small>}
            {author?.committer && (author.committer.name !== author.author?.name || author.committer.email !== author.author?.email) && <p className="github-authorship-committer">Committer: {author.committer.name} &lt;{author.committer.email}&gt;</p>}
          </div>
        </div>
        <div className="settings-general-control">
          <Button variant="outline" size="sm" onClick={() => setAuthorOpen(true)} disabled={authorship.isPending || !author}>Edit authorship</Button>
        </div>
      </div>
      {author?.blockers.map((blocker) => <p className="github-settings-notice" key={blocker}>{blocker}</p>)}
      {authorship.error && <p className="github-settings-notice" role="alert">{messageOf(authorship.error)}</p>}
    </section>
    <section className="settings-general-group github-access-checks" aria-labelledby={`${id}-access`}>
      <h3 id={`${id}-access`}><IconShieldCheck aria-hidden="true" />Access</h3>
      {account?.access ? <RepositoryAccessStatus access={account.access} action={checkButton} checking={checking || saving} />
        : <SettingRow label="Access not checked" description="">{checkButton}</SettingRow>}
      {account?.access?.identity.state === 'expired' && <Button variant="outline" size="sm" onClick={() => { setReconnectLogin(account.login ?? pinnedLogin); setAddOpen(true); }}>Reconnect account</Button>}
      {context.error && <p className="github-settings-notice" role="alert">{messageOf(context.error)}</p>}
    </section>
    <details className="github-authentication-details"><summary>Advanced · Git</summary>
    <div className="github-advanced-content">
      <dl className="github-repository-destination">
        <div><dt>Push destination</dt><dd>{destination}<small>{branchLabel}{publication?.remote && ` · ${publication.remote}`}</small></dd></div>
        {separatePrDestination && <div><dt>Pull requests</dt><dd>{repoName}</dd></div>}
      </dl>
      <SettingRow label="Git authentication" description={managed
        ? `Uses ${pinnedLogin ? `@${pinnedLogin}’s` : 'the repository account’s'} saved GitHub CLI credentials for HTTPS, independently of the active CLI account.`
        : `Git uses credentials configured on ${gitCredentialsLocation()}. They may belong to another account.`}>
        <Select value={managed ? 'managed' : 'external'} onValueChange={value => { if (value === 'managed' || value === 'external') void choose(selection, value); }} disabled={saving}>
          <Tooltip>
            <TooltipTrigger render={<SelectTrigger className="settings-general-select w-[220px] text-[11px] font-normal" aria-label="Git authentication" />}>
              <SelectValue>{gitAuthenticationLabel}</SelectValue>
            </TooltipTrigger>
            <TooltipContent>{gitAuthenticationLabel}</TooltipContent>
          </Tooltip>
          <SelectContent align="end">
            <SelectItem value="managed" disabled={selection === 'auto' || (Boolean(account?.access) && !compatible)} className="min-h-8 text-xs font-normal">{repositoryAccountLabel}</SelectItem>
            <SelectItem value="external" className="min-h-8 text-xs font-normal">Existing Git credentials</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {(selection === 'auto' || (Boolean(account?.access) && !compatible)) && <p className="github-settings-note">{selection === 'auto' ? 'Choose an account above to use it for GitHub HTTPS.' : 'This destination uses Git’s own authentication. Using the repository account requires GitHub HTTPS.'}</p>}
      {account?.access && <div className="github-diagnostics-action"><CopyAccessDiagnostics access={account.access} accountLogin={account.login ?? pinnedLogin} /></div>}
    </div>
    </details>
    </div>
    </>}
    </>}
    </Tabs.Panel>
    <Tabs.Panel value="global" className="github-scope-panel">
    <header className="github-scope-heading">
      <IconUsers aria-hidden="true" /><div><h2>GitHub accounts</h2>
        <p>Shared by all clients connected to this instance.</p></div>
    </header>
    <section className="settings-general-group" aria-label="Suggested account">
      <SettingRow label="Suggested account for new repositories" description="Preselected when adding a repository. Existing repository accounts stay unchanged.">
        <SearchablePicker groups={[{ id: 'accounts', label: 'Connected accounts', items: selectable }]}
          value={status?.suggestedLogin ?? ''} triggerLabel={status?.suggestedLogin ? `@${status.suggestedLogin}` : 'Choose a suggestion'}
          label="Suggested account" placeholder="Search accounts…" size="sm" disabled={saving}
          onValueChange={login => {
            setSaving(true);
            void opentig.github.setSuggestedAccount(login).then(next => client.setQueryData(queryKeys.githubAccounts, next))
              .catch(error => sileo.error({ title: 'Could not save suggested account', description: messageOf(error) })).finally(() => setSaving(false));
          }} />
      </SettingRow>
    </section>
    <section className="settings-general-group github-global-accounts" aria-label="Accounts available to OpenTig">
      <h3><IconUsers aria-hidden="true" />Available accounts</h3>
      <SettingRow label="Saved accounts" description={`Saved in GitHub CLI on ${gitCredentialsLocation()}. Git's own credentials are managed separately.`}>
        <div className="github-accounts-actions">
          <Button variant="outline" size="sm" className="github-refresh-accounts" onClick={() => void check()} disabled={busy}>
            {checking ? <IconLoader4 className="animate-spin" /> : <IconRefresh />}{checking ? <ShimmeringText text="Checking…" /> : 'Refresh accounts'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setReconnectLogin(null); setAddOpen(true); }}><IconPlus />Add account</Button>
        </div>
      </SettingRow>
      {status?.message && <p className="github-settings-notice" role="status">{status.message}</p>}
      {inventory.error && <p className="github-settings-notice" role="alert">{messageOf(inventory.error)}</p>}
      <div className="github-accounts-list">{accounts.map((item) => {
        const repositoryCount = status?.repositoryAccounts?.filter(repo => repo.login === item.login).length ?? 0;
        return <div className="github-account-row" key={item.login}>
        <span className="github-account-avatar" aria-hidden="true">{item.login.slice(0, 2).toUpperCase()}</span>
        <div className="github-account-copy"><strong>@{item.login}</strong><small>{repositoryCount ? `Used by ${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'}` : 'No repositories assigned'}</small></div>
        <div className="github-account-badges">{status?.suggestedLogin === item.login && <Badge variant="secondary">Suggested for new repos</Badge>}
          <span className={`github-auth-state ${item.state}`}>{item.state === 'authenticated' ? 'Connected' : item.state === 'invalid' ? 'Reconnect' : 'Not checked'}</span>
          {item.state === 'invalid' && <Button variant="outline" size="xs" onClick={() => { setReconnectLogin(item.login); setAddOpen(true); }}>Reconnect account</Button>}</div>
      </div>; })}</div>
      {!accounts.length && <p className="github-settings-note">{status?.checkedAt ? 'No saved accounts found. Add an account and check again.' : 'Refresh accounts to list saved accounts.'}</p>}
    <section className="github-cli-section" aria-label="GitHub CLI">
      <div className="settings-general-row">
        <div className="github-cli-version"><strong>GitHub CLI</strong>{status?.version && <span>{status.version.replace(/^gh version\s+/i, '').split(' (')[0]}</span>}</div>
        <Badge variant="outline">{installationLabel(status)}</Badge>
      </div>
      {status?.environment.present && <p className="github-settings-note">Environment credentials: {status.environment.login ? `@${status.environment.login}` : 'identity not verified'}. May be used by unpinned HTTPS repositories.</p>}
    </section>
    </section>
    </Tabs.Panel>
    </div>
    <footer className="settings-general-footer">
      <span><IconCheck aria-hidden="true" />Saved on the server · shared by connected clients</span>
      <span>{status?.checkedAt ? `Last checked ${formatDateTime(status.checkedAt, { seconds: true })}` : 'Uses saved results until you refresh'}</span>
    </footer>
    {repository && <CommitAuthorshipDialog key={repository.id} repository={repository} open={authorOpen} onOpenChange={setAuthorOpen} />}
    <AddGitHubAccountDialog reconnectLogin={reconnectLogin} open={addOpen} onOpenChange={setAddOpen} status={status} onCheck={() => check()} checking={checking} />
  </Tabs.Root>;
}

function SettingRow({ label, description, children }: { label: string; description: ReactNode; children: ReactNode }) {
  return <div className="settings-general-row github-settings-row">
    <div className="settings-field-label"><strong>{label}</strong><span>{description}</span></div>
    <div className="settings-general-control">{children}</div>
  </div>;
}

function AddGitHubAccountDialog({ open, onOpenChange, status, onCheck, checking, reconnectLogin }: {
  reconnectLogin: string | null;
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
    <DialogTitle>{step === 2 ? 'Check the updated accounts' : reconnectLogin ? `Reconnect @${reconnectLogin}` : 'Add a GitHub account'}</DialogTitle>
    <DialogDescription>Connect with GitHub CLI on {gitCredentialsLocation()}. Return here after authorizing your account.</DialogDescription>
    <div className="github-add-steps" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((item) => <span key={item} className={item <= step ? 'active' : ''} />)}</div>
    {step === 0 ? <>
      <p>Your saved accounts are kept. There is no need to log out first.</p>
      <p className="github-settings-notice"><strong>GitHub CLI activates the account you connect.</strong> This can affect other terminals and HTTPS repositories using existing automatic authentication. OpenTig will not switch the global account back automatically.</p>
      <p>Keep Git credential setup and SSH key management unchanged during login. Your account selection in OpenTig is saved separately.</p>
    </> : step === 1 ? <>
      <div className="github-login-command"><code>gh auth login --hostname github.com --web --skip-ssh-key</code><Button variant="ghost" size="icon-sm" aria-label="Copy GitHub login command" onClick={() => void copy('gh auth login --hostname github.com --web --skip-ssh-key')}><IconCopy /></Button></div>
      <ol><li>Run the command in a terminal on {gitCredentialsLocation()}, where OpenTig runs.</li><li>Keep your existing Git protocol. If gh offers to authenticate Git, answer <strong>No</strong>. Skip creating or uploading SSH keys.</li><li>Verify the intended account in your browser before authorising GitHub CLI.</li><li>Return here and check the accounts. If backend token environment variables prevent login, manage them in that terminal; OpenTig does not edit them.</li></ol>
      {previous && <p className="github-settings-note">Previously checked active account: @{previous}.</p>}
    </> : <>
      <p>{added.length ? `Connected accounts: ${added.map((account) => `@${account.login}`).join(', ')}.` : 'No new saved account was detected. You can check again after finishing the login.'}</p>
      <p className="github-settings-notice">Last checked active account: {status?.activeLogin ? `@${status.activeLogin}` : 'not available'}. Existing accounts and explicit repository selections are preserved.</p>
      {previous && previous !== status?.activeLogin && <><p>To restore the previous global account, run this command voluntarily in your terminal:</p>
        <div className="github-login-command"><code>gh auth switch --hostname github.com --user {previous}</code><Button variant="ghost" size="icon-sm" aria-label="Copy restore global account command" onClick={() => void copy(`gh auth switch --hostname github.com --user ${previous}`)}><IconCopy /></Button></div></>}
      <p className="github-settings-note">These commands are only copied. OpenTig never executes login, logout or account switching.</p>
    </>}
    <div className="github-add-actions"><Button variant="ghost" onClick={() => close(false)}>{step === 2 ? 'Done' : 'Cancel'}</Button>
      {step === 0 ? <Button onClick={() => { setPrevious(status?.activeLogin ?? null); setKnown(status?.accounts.filter(account => account.state === 'authenticated' && account.login !== reconnectLogin).map(account => account.login) ?? []); setStep(1); }}>View instructions</Button>
        : <Button onClick={() => void onCheck().then((next) => { if (next?.accounts.some(item => item.state === 'authenticated' && !known.includes(item.login))) setStep(2); else if (next) sileo.error({ title: 'Account not connected yet', description: 'Finish the login or reconnect the account, then check again. Your repository choice is unchanged.' }); })} disabled={checking}>{checking && <IconLoader4 className="animate-spin" />}{checking ? <ShimmeringText text={step === 1 ? 'I have finished · check accounts' : 'Check again'} /> : step === 1 ? 'I have finished · check accounts' : 'Check again'}</Button>}
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
