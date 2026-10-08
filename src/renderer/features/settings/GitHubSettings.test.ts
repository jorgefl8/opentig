// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommitAuthorship } from '@shared/commit-authorship';
import type { RepositoryInfo } from '@shared/contracts';
import type { GitHubAccountsStatus, GitHubRepositoryAccount } from '@shared/github-accounts';
import { GitHubSettings } from './GitHubSettings';

const calls = vi.hoisted(() => ({ accountsStatus: vi.fn(), repositoryAccount: vi.fn(), setRepositoryAccount: vi.fn(), setDefaultAccount: vi.fn(), authorship: vi.fn(), setAuthorship: vi.fn(), error: vi.fn(), copy: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: calls, commits: calls, events: { onRepositoryChanged: () => () => undefined } } }));
vi.mock('sileo', () => ({ sileo: { error: calls.error, success: vi.fn() } }));
vi.mock('@/lib/browser-capabilities', () => ({ writeClipboardText: calls.copy }));
vi.mock('motion/react', async (original) => ({ ...await original<typeof import('motion/react')>(), useReducedMotion: () => true }));
const repository: RepositoryInfo = { id: 'repo', name: 'demo', repositoryName: 'demo', path: '/fixture/demo', commonDir: '/fixture/demo/.git' };
const saved: GitHubAccountsStatus = { installationStatus: 'available', version: 'gh version 2.88.0', checkedAt: '2026-10-06T10:00:00.000Z', activeLogin: 'alice',
  environment: { present: false, login: null, state: 'unknown' }, accounts: [
    { host: 'github.com', login: 'alice', active: true, state: 'authenticated', storage: 'keyring' },
    { host: 'github.com', login: 'bob', active: false, state: 'authenticated', storage: 'file' },
  ] };
const context: GitHubRepositoryAccount = { selection: { mode: 'auto' }, nameWithOwner: 'organisation/demo', login: 'bob', source: 'ssh', state: 'ready', checkedAt: saved.checkedAt, revision: 1 };
const identity: CommitAuthorship = { author: { name: 'Alice Sample', email: 'alice@example.com' }, committer: { name: 'Alice Sample', email: 'alice@example.com' }, source: 'global', editable: true, blockers: [], revision: 'a'.repeat(64) };
beforeEach(() => { calls.authorship.mockResolvedValue(identity); });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function mount(repo: RepositoryInfo | null = repository) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div'); document.body.append(container);
  let root = createRoot(container);
  const render = () => root.render(createElement(QueryClientProvider, { client }, createElement(GitHubSettings, { repository: repo })));
  await act(async () => { render(); await settle(); }); await act(settle);
  return { container, client,
    switchRepository: async (next: RepositoryInfo) => { repo = next; await act(async () => { render(); await settle(); }); await act(settle); },
    reopen: async () => { await act(async () => root.unmount()); root = createRoot(container); await act(async () => { render(); await settle(); }); await act(settle); },
    close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); },
  };
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  expect(button).toBeDefined();
  await act(async () => { button!.click(); await settle(); }); await act(settle);
}

async function scopeTab(name: 'This repository' | 'OpenTig') {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(item => item.textContent === name);
  expect(tab).toBeDefined();
  await act(async () => { tab!.click(); await settle(); });
}

it('opens and reopens saved accounts without authentication checks and distinguishes both identities', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    expect(view.container.querySelector('.github-access-card')?.textContent).toContain('@bob');
    await scopeTab('OpenTig');
    expect(view.container.textContent).toContain('Active in gh');
    expect(view.container.textContent).toContain('06/10/2026');
    await view.reopen();
    expect(calls.accountsStatus).toHaveBeenCalledExactlyOnceWith(false);
    expect(calls.repositoryAccount).toHaveBeenCalledExactlyOnceWith('repo', false);
  } finally { await view.close(); }
});

it('refreshes explicitly, retaining saved state during the check and updating the repository identity', async () => {
  let release!: (value: GitHubAccountsStatus) => void;
  calls.accountsStatus.mockResolvedValueOnce(saved).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  calls.repositoryAccount.mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, login: 'alice', source: 'global' });
  const view = await mount();
  try {
    await click('Check access');
    expect(view.container.textContent).toContain('Checking…');
    await scopeTab('OpenTig');
    expect(view.container.textContent).toContain(saved.version);
    await act(async () => { release({ ...saved, checkedAt: '2026-10-07T10:00:00.000Z' }); await settle(); }); await act(settle);
    expect(calls.accountsStatus).toHaveBeenLastCalledWith(true);
    expect(calls.repositoryAccount).toHaveBeenLastCalledWith('repo', true);
    expect(view.container.textContent).toContain('07/10/2026');
    await scopeTab('This repository');
    expect(view.container.querySelector('.github-access-card')?.textContent).toContain('@alice');
  } finally { await view.close(); }
});

it('guides external login without running it and offers a voluntary global restore command', async () => {
  calls.accountsStatus.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, activeLogin: 'carol', accounts: [...saved.accounts,
    { host: 'github.com', login: 'carol', active: true, state: 'authenticated', storage: 'keyring' }] });
  calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    await scopeTab('OpenTig'); await click('Add account');
    expect(document.body.textContent).toContain('GitHub CLI activates the account you add');
    await click('View instructions');
    const command = document.querySelector<HTMLButtonElement>('[aria-label="Copy GitHub login command"]');
    await act(async () => command!.click());
    expect(calls.copy).toHaveBeenCalledWith('gh auth login --hostname github.com --web --skip-ssh-key');
    expect(calls.accountsStatus).toHaveBeenCalledExactlyOnceWith(false);
    await click('I have finished');
    expect(document.body.textContent).toContain('Newly detected accounts: @carol');
    expect(document.body.textContent).toContain('gh auth switch --hostname github.com --user alice');
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it('keeps the previous inventory when a manual request fails', async () => {
  calls.accountsStatus.mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('Disconnected'));
  calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    await click('Check access');
    await scopeTab('OpenTig');
    expect(view.container.textContent).toContain(saved.version);
    expect(calls.error).toHaveBeenCalledWith(expect.objectContaining({ description: 'Disconnected' }));
  } finally { await view.close(); }
});

async function input(id: string, value: string) {
  const node = document.getElementById(id) as HTMLInputElement;
  expect(node).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('places repository and Git identities first and requires review before applying local authorship', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  calls.setAuthorship.mockResolvedValue({ ...identity, source: 'local', author: { name: 'Bob Contributor', email: 'bob@example.com' } });
  const view = await mount();
  try {
    expect(view.container.querySelector('.github-repository-heading')?.textContent).toContain('organisation/demo');
    expect(view.container.querySelector('.github-authorship-card')?.textContent).toContain('Alice Sample');
    expect(view.container.querySelector('.github-repository-heading')).toBe(view.container.querySelector('[role=tabpanel]')?.firstElementChild);
    await click('Edit authorship');
    expect(document.getElementById('commit-author-name')).toHaveProperty('value', 'Alice Sample');
    expect(calls.setAuthorship).not.toHaveBeenCalled();
    await input('commit-author-name', 'Bob Contributor'); await input('commit-author-email', 'bob@example.com');
    await click('Review changes');
    expect(document.body.textContent).toContain('New author and committer');
    expect(document.body.textContent).toContain('including commits from other Git tools');
    expect(calls.setAuthorship).not.toHaveBeenCalled();
    await click('Apply to repository');
    expect(calls.setAuthorship).toHaveBeenCalledExactlyOnceWith('repo', { name: 'Bob Contributor', email: 'bob@example.com', expectedRevision: identity.revision });
    expect(view.container.querySelector('.github-authorship-card')?.textContent).toContain('Bob Contributor');
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it('keeps edits local to the dialog until applied and cancels without writing', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    await click('Edit authorship');
    await input('commit-author-name', 'Unsaved Name');
    await click('Cancel');
    expect(calls.setAuthorship).not.toHaveBeenCalled();
    expect(view.container.querySelector('.github-authorship-card')?.textContent).toContain('Alice Sample');
  } finally { await view.close(); }
});

it('explains overrides, shows a distinct committer and disables ineffective changes', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  calls.authorship.mockResolvedValue({ ...identity, committer: { name: 'Other Committer', email: 'other@example.com' }, source: 'environment', editable: false, blockers: ['Backend environment variables override Git identity.'] });
  const view = await mount();
  try {
    expect(view.container.textContent).toContain('Committer: Other Committer');
    await click('Edit authorship');
    expect(document.getElementById('commit-author-name')).toHaveProperty('disabled', true);
    const review = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Review changes');
    expect(review).toHaveProperty('disabled', true);
    expect(document.body.textContent).toContain('Backend environment variables override Git identity.');
    expect(calls.setAuthorship).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it('retains the reviewed draft after a stale identity rejection and never reports it as saved', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  calls.setAuthorship.mockRejectedValue(new Error('Git settings changed. Reopen the editor.'));
  const view = await mount();
  try {
    await click('Edit authorship'); await input('commit-author-name', 'Bob Contributor');
    await click('Review changes'); await click('Apply to repository');
    expect(document.body.textContent).toContain('Git settings changed. Reopen the editor.');
    expect(document.body.textContent).toContain('Bob Contributor');
    expect(view.container.querySelector('.github-authorship-card')?.textContent).toContain('Alice Sample');
  } finally { await view.close(); }
});

it('keeps unavailable explicit accounts visible instead of displaying another identity', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  calls.repositoryAccount.mockResolvedValue({ ...context, selection: { mode: 'account', login: 'missing', host: 'github.com' }, state: 'error', login: 'missing', message: 'The selected account is not saved in gh.' });
  const view = await mount();
  try {
    expect(view.container.querySelector('.github-access-card')?.textContent).toContain('@missing');
    expect(view.container.textContent).toContain('The selected account is not saved in gh.');
    await scopeTab('OpenTig');
    expect(view.container.querySelector('.github-global-account')?.textContent).toContain('@alice');
  } finally { await view.close(); }
});

it('requires an open repository for identity editing and keeps global accounts available', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  const view = await mount(null);
  try {
    expect(view.container.querySelector('[role=tab][data-disabled]')?.textContent).toBe('This repository');
    expect(view.container.querySelector('.github-repository-heading')).toBeNull();
    expect(view.container.textContent).not.toContain('Edit authorship');
    expect(calls.authorship).not.toHaveBeenCalled();
    expect(calls.repositoryAccount).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('@alice');
  } finally { await view.close(); }
});


it('keeps the login instructions open when adding an account fails', async () => {
  calls.accountsStatus.mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('offline'));
  calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    await scopeTab('OpenTig'); await click('Add account'); await click('View instructions'); await click('I have finished');
    expect(document.body.textContent).toContain('I have finished');
    expect(document.body.textContent).not.toContain('Newly detected accounts');
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
    expect(calls.error).toHaveBeenCalled();
  } finally { await view.close(); }
});

it('never puts a late check from repository A into repository B', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  let resolve!: (value: GitHubRepositoryAccount) => void;
  calls.repositoryAccount.mockImplementation((id: string, force: boolean) => force
    ? new Promise(done => { resolve = done; }) : Promise.resolve({ ...context, login: id === 'repo' ? 'alice' : 'bob' }));
  const view = await mount();
  try {
    await click('Check access');
    await view.switchRepository({ ...repository, id: 'second', name: 'second' });
    await act(async () => { resolve({ ...context, login: 'alice' }); await settle(); }); await act(settle);
    expect(view.container.querySelector('.github-access-card')?.textContent).toContain('@bob');
  } finally { await view.close(); }
});

it('migrates only on opt-in and can return to external Git authentication', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  let selected: GitHubRepositoryAccount = { ...context, source: 'explicit', selection: { mode: 'account', host: 'github.com', login: 'alice' } };
  calls.repositoryAccount.mockImplementation(() => Promise.resolve(selected));
  calls.setRepositoryAccount.mockImplementation((_id, choice) => { selected = { ...selected, selection: choice }; return Promise.resolve(selected); });
  const view = await mount();
  try {
    expect(view.container.querySelector('input[value=external]')).toHaveProperty('checked', true);
    expect(view.container.querySelector('input[value=external]')?.closest('label')?.textContent).toContain('Git credentials');
    expect(view.container.querySelector('input[value=managed]')?.closest('label')?.textContent).toContain('@alice');
    expect(view.container.textContent).toContain('They may belong to a different account');
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
    await act(async () => { view.container.querySelector<HTMLInputElement>('input[value=managed]')!.click(); await settle(); }); await act(settle);
    expect(calls.setRepositoryAccount).toHaveBeenLastCalledWith('repo', { mode: 'account', host: 'github.com', login: 'alice', gitMode: 'managed' });
    expect(view.container.querySelector('input[value=managed]')).toHaveProperty('checked', true);
    expect(view.container.textContent).toContain('PRs and Git HTTPS both use @alice.');
    await act(async () => { view.container.querySelector<HTMLInputElement>('input[value=external]')!.click(); await settle(); }); await act(settle);
    expect(calls.setRepositoryAccount).toHaveBeenLastCalledWith('repo', { mode: 'account', host: 'github.com', login: 'alice', gitMode: 'external' });
    expect(calls.setAuthorship).not.toHaveBeenCalled();
  } finally { await view.close(); }
});


it('preserves the authorship draft when account inventory and authorship queries refresh', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    await click('Edit authorship'); await input('commit-author-name', 'Unsaved local draft');
    await act(async () => {
      view.client.setQueryData(['repository', 'repo', 'commit-authorship'], { ...identity, author: { name: 'Refreshed name', email: 'refresh@example.com' } });
      await view.client.invalidateQueries({ queryKey: ['github', 'accounts'] });
    });
    expect(document.querySelector<HTMLInputElement>('#commit-author-name')?.value).toBe('Unsaved local draft');
    expect(calls.setAuthorship).not.toHaveBeenCalled();
    await click('Cancel');
  } finally { await view.close(); }
});

it('keeps technical details collapsed while showing the destination and external Git identity', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  const publication = { id: 'review', repositoryId: 'repo', branch: 'feature/demo', oid: 'a'.repeat(40), targetRef: 'refs/heads/feature/demo', remote: 'fork', urls: ['https://github.com/alice/demo.git'], remotes: ['fork', 'upstream'], mode: 'external', login: null };
  calls.repositoryAccount.mockResolvedValue({ ...context, access: {
    publication, identity: { state: 'ok' }, api: { state: 'ok' }, read: { state: 'external' }, write: { state: 'unchecked' }, checkedAt: saved.checkedAt,
    lastOperation: { operation: 'fetch', url: publication.urls[0], login: null, at: saved.checkedAt, ok: true },
  } });
  const view = await mount();
  try {
    expect(view.container.querySelector('.github-push-destination')?.textContent).toContain('alice/demo · HTTPS');
    expect(view.container.querySelector('.github-push-destination')?.textContent).not.toContain('Git account');
    expect(view.container.querySelector('.github-push-destination')?.textContent).not.toContain('@bob');
    expect(view.container.querySelector('input[value=external]')?.closest('label')?.textContent).toContain('Git credentials');
    expect(view.container.querySelector('input[value=managed]')?.closest('label')?.textContent).toContain('Use this account');
    expect(view.container.textContent).toContain('Choose an account above to use it for Git HTTPS too.');
    expect(view.container.querySelector('.github-access-grid')?.textContent).toContain('Not checked');
    expect(view.container.querySelector('.github-access-details')).toHaveProperty('open', false);
    expect(view.container.querySelector('.github-access-details summary')?.textContent).toBe('Technical details');
    expect(view.client.getQueryData(['repository', 'repo', 'push-context'])).toEqual(publication);
    expect(view.container.querySelector('input[value=managed]')).toHaveProperty('disabled', true);
    await act(async () => { view.container.querySelector<HTMLElement>('.github-access-details summary')!.click(); });
    expect(view.container.querySelector('.github-access-details')).toHaveProperty('open', true);
    expect(view.container.querySelector('.github-access-details')?.textContent).toContain(publication.urls[0]);
    expect(view.container.querySelector('.github-access-details')?.textContent).toContain('Git credentials');
    expect(view.container.querySelector('.github-access-details')?.textContent).not.toContain('Git uses existing helpers');
    await act(async () => { view.container.querySelector<HTMLButtonElement>('[aria-label="Copy technical details"]')!.click(); await settle(); });
    expect(calls.copy).toHaveBeenCalledWith(expect.stringContaining('https://github.com/alice/demo.git'));
    await scopeTab('OpenTig');
    expect(view.container.querySelector('.github-saved-accounts')).toHaveProperty('open', false);
  } finally { await view.close(); }
});

it('exposes actionable failures without requiring users to open diagnostics', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  calls.repositoryAccount.mockResolvedValue({ ...context, access: {
    publication: { id: 'review', repositoryId: 'repo', branch: 'main', oid: 'a'.repeat(40), targetRef: 'refs/heads/main', remote: 'origin', urls: ['https://github.com/org/demo.git'], remotes: ['origin'], mode: 'managed', login: 'bob' },
    identity: { state: 'expired', message: 'Reconnect @bob or choose another account.' }, api: { state: 'unchecked' }, read: { state: 'unchecked' }, write: { state: 'unchecked' }, checkedAt: saved.checkedAt,
    lastOperation: { operation: 'fetch', url: 'https://github.com/org/demo.git', login: 'bob', at: saved.checkedAt, ok: false, message: 'Authentication failed for that destination.' },
  } });
  const view = await mount();
  try {
    expect(view.container.querySelector('.github-access-grid')?.textContent).toContain('Reconnect account');
    expect([...view.container.querySelectorAll('[role=status]')].some(node => !node.closest('details') && node.textContent?.includes('Reconnect @bob'))).toBe(true);
    expect([...view.container.querySelectorAll('[role=status]')].some(node => !node.closest('details') && node.textContent?.includes('Last fetch failed'))).toBe(true);
    expect([...view.container.querySelectorAll('[role=status]')].some(node => !node.closest('details') && node.textContent?.includes('Authentication failed'))).toBe(true);
    expect(view.container.querySelector('.github-access-details')).toHaveProperty('open', false);
    expect(view.container.querySelector('.github-access-details summary')?.textContent).toContain('Last Git operation failed');
    expect([...view.container.querySelectorAll('button')].find(node => node.textContent === 'Check access')).toHaveProperty('disabled', false);
  } finally { await view.close(); }
});

async function choosePicker(label: string, option: string) {
  await act(async () => { document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(); await settle(); });
  const node = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(item => item.textContent?.includes(option));
  expect(node).toBeDefined();
  await act(async () => { node!.click(); await settle(); }); await act(settle);
}
it('sets the OpenTig default separately and lets a repository explicitly follow it', async () => {
  calls.accountsStatus.mockResolvedValue({ ...saved, defaultLogin: 'alice' }); calls.repositoryAccount.mockResolvedValue(context);
  calls.setDefaultAccount.mockResolvedValue({ ...saved, defaultLogin: 'bob' });
  calls.setRepositoryAccount.mockResolvedValue({ ...context, selection: { mode: 'account', host: 'github.com', login: 'bob', useGlobalDefault: true } });
  const view = await mount();
  try {
    await scopeTab('OpenTig');
    await choosePicker('Global default account', '@bob');
    expect(calls.setDefaultAccount).toHaveBeenCalledWith('bob');
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
    expect(calls.setAuthorship).not.toHaveBeenCalled();
    await scopeTab('This repository');
    await choosePicker('GitHub account for this repository', 'Global default');
    expect(calls.setRepositoryAccount).toHaveBeenCalledWith('repo', { mode: 'account', host: 'github.com', login: 'bob', gitMode: 'external', useGlobalDefault: true });
  } finally { await view.close(); }
});

const externalAccess = {
  publication: { id: 'review', repositoryId: 'repo', branch: 'main', oid: 'a'.repeat(40), targetRef: 'refs/heads/main', remote: 'origin', urls: ['https://github.com/org/demo.git'], remotes: ['origin'], mode: 'external' as const, login: null },
  identity: { state: 'ok' as const }, api: { state: 'ok' as const }, read: { state: 'external' as const }, write: { state: 'ok' as const }, checkedAt: saved.checkedAt,
};

it('uses a newly selected account for HTTPS Git and PRs without changing global defaults or authorship', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  let selected: GitHubRepositoryAccount = { ...context, access: externalAccess };
  calls.repositoryAccount.mockImplementation(() => Promise.resolve(selected));
  calls.setRepositoryAccount.mockImplementation((_id, selection) => {
    selected = { ...selected, selection, login: selection.login, access: { ...externalAccess,
      publication: { ...externalAccess.publication, mode: 'managed', login: selection.login } } };
    return Promise.resolve(selected);
  });
  const view = await mount();
  try {
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
    await choosePicker('GitHub account for this repository', '@alice');
    expect(calls.setRepositoryAccount).toHaveBeenCalledWith('repo', { mode: 'account', host: 'github.com', login: 'alice', gitMode: 'managed' });
    expect(view.container.querySelector('input[value=managed]')).toHaveProperty('checked', true);
    expect(view.container.querySelector('.github-git-summary')?.textContent).toContain('GitHub / PRs: @alice');
    expect(view.container.querySelector('.github-git-summary')?.textContent).toContain('Fetch / push: @alice');
    expect(calls.setDefaultAccount).not.toHaveBeenCalled();
    expect(calls.setAuthorship).not.toHaveBeenCalled();
  } finally { await view.close(); }
});

it('preserves an explicit external Git choice and names the account checked by the API', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  let selected: GitHubRepositoryAccount = { ...context, selection: { mode: 'account', host: 'github.com', login: 'alice', gitMode: 'external' }, login: 'alice', access: externalAccess };
  calls.repositoryAccount.mockImplementation(() => Promise.resolve(selected));
  calls.setRepositoryAccount.mockImplementation((_id, selection) => { selected = { ...selected, selection, login: selection.login }; return Promise.resolve(selected); });
  const view = await mount();
  try {
    expect(view.container.querySelector('.github-git-summary')?.textContent).toContain('Fetch / push: Git credentials · account unverified');
    expect(view.container.textContent).toContain('configured on the server');
    expect(view.container.textContent).toContain("These GitHub checks do not verify access with Git's own credentials");
    expect(view.container.querySelector('.github-access-grid')?.textContent).toContain('Write permission · @alice');
    await choosePicker('GitHub account for this repository', '@bob');
    expect(calls.setRepositoryAccount).toHaveBeenCalledWith('repo', { mode: 'account', host: 'github.com', login: 'bob', gitMode: 'external' });
    expect(view.container.querySelector('input[value=external]')).toHaveProperty('checked', true);
    expect(view.container.querySelector('.github-access-grid')?.textContent).toContain('Write permission · @bob');
  } finally { await view.close(); }
});

it('identifies desktop Git credentials as belonging to this computer', async () => {
  vi.stubGlobal('opentigDesktop', {});
  calls.accountsStatus.mockResolvedValue(saved);
  calls.repositoryAccount.mockResolvedValue({ ...context, access: externalAccess });
  const view = await mount();
  try { expect(view.container.textContent).toContain('configured on this computer'); }
  finally { await view.close(); }
});

it('keeps SSH authentication external when choosing a GitHub account', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  calls.repositoryAccount.mockResolvedValue({ ...context, access: { ...externalAccess, publication: { ...externalAccess.publication, urls: ['git@github.com:org/demo.git'] } } });
  calls.setRepositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    expect(view.container.querySelector('input[value=managed]')).toHaveProperty('disabled', true);
    await choosePicker('GitHub account for this repository', '@alice');
    expect(calls.setRepositoryAccount).toHaveBeenCalledWith('repo', { mode: 'account', host: 'github.com', login: 'alice', gitMode: 'external' });
  } finally { await view.close(); }
});

it('separates repository controls from instance-wide controls and labels their scope', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    expect(view.container.querySelector('[role=tab][data-active]')?.textContent).toBe('This repository');
    expect(view.container.textContent).toContain('Shared with its worktrees and connected clients.');
    expect(view.container.querySelector('button[aria-label="Global default account"]')).toBeNull();
    expect(view.container.textContent).not.toContain('Add account');
    await click('Manage accounts in OpenTig');
    expect(view.container.querySelector('[role=tab][data-active]')?.textContent).toBe('OpenTig');
    expect(view.container.textContent).toContain('Shared by all clients connected to this instance.');
    expect(view.container.querySelector('button[aria-label="GitHub account for this repository"]')).toBeNull();
    expect(view.container.textContent).not.toContain('Edit authorship');
    expect(view.container.textContent).toContain('Add account');
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it('refreshes global accounts without checking the active repository or its author', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    await scopeTab('OpenTig'); await click('Refresh accounts');
    expect(calls.accountsStatus).toHaveBeenLastCalledWith(true);
    expect(calls.repositoryAccount).toHaveBeenCalledExactlyOnceWith(repository.id, false);
    expect(calls.authorship).toHaveBeenCalledOnce();
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
    expect(calls.setAuthorship).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
it('opens instance-wide settings directly without a repository', async () => {
  calls.accountsStatus.mockResolvedValue(saved);
  const view = await mount(null);
  try {
    expect(view.container.querySelector('[role=tab][data-active]')?.textContent).toBe('OpenTig');
    expect(view.container.querySelector('[role=tab][data-disabled]')?.textContent).toBe('This repository');
    await click('Refresh accounts');
    expect(calls.repositoryAccount).not.toHaveBeenCalled();
    expect(calls.authorship).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain('Open a repository to choose');
  } finally { await view.close(); }
});
