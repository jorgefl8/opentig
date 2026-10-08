// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GitHubAccountsStatus, GitHubRepositoryAccount } from '@shared/github-accounts';
import { RepositoryAccountSetup } from './RepositoryAccountSetup';
import { supportsManagedSetup } from '@/features/refs/publication-context';
const calls = vi.hoisted(() => ({ accountsStatus: vi.fn(), repositoryAccount: vi.fn(), setRepositoryAccount: vi.fn(), completeSetup: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: calls, repository: calls } }));
vi.mock('./GitHubSettings', () => ({ GitHubSettings: () => createElement('div', null, 'Manage accounts') }));
vi.mock('motion/react', async original => ({ ...await original<typeof import('motion/react')>(), useReducedMotion: () => true }));
const repository = { id: 'new', name: 'Demo', repositoryName: 'Demo', path: '/fixture/demo', commonDir: '/fixture/demo/.git' };
const inventory: GitHubAccountsStatus = { installationStatus: 'available', activeLogin: 'alice', defaultLogin: 'bob', checkedAt: null, environment: { present: false, login: null, state: 'unknown' }, accounts: [
  { host: 'github.com', login: 'alice', active: true, state: 'authenticated', storage: 'keyring' },
  { host: 'github.com', login: 'bob', active: false, state: 'authenticated', storage: 'keyring' },
] };
const unchecked: GitHubRepositoryAccount = { selection: { mode: 'auto' }, nameWithOwner: 'org/demo', login: null, source: null, state: 'unchecked', checkedAt: null, revision: 3, access: {
  publication: { id: 'context', repositoryId: 'new', branch: 'main', oid: 'abc', targetRef: 'refs/heads/main', remote: 'origin', remotes: ['origin'], urls: ['https://github.com/org/demo.git'], mode: 'external', login: null },
  identity: { state: 'unchecked' }, api: { state: 'unchecked' }, read: { state: 'external' }, write: { state: 'unchecked' }, checkedAt: null,
} };
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  calls.accountsStatus.mockResolvedValue(inventory); calls.repositoryAccount.mockImplementation((_id, verify) => Promise.resolve(verify ? { ...unchecked, state: 'ready' } : unchecked)); calls.setRepositoryAccount.mockResolvedValue(unchecked); calls.completeSetup.mockResolvedValue(repository);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
async function mount(isNew = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node); const close = vi.fn(); const added = vi.fn();
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(RepositoryAccountSetup, { repository, isNew, onClose: close, onAdded: added }))); await settle(); }); await act(settle);
  return { client, close, added, dispose: async () => { await act(async () => root.unmount()); client.clear(); node.remove(); } };
}
async function click(name: string) {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes(name)); expect(button).toBeDefined();
  await act(async () => { button!.click(); await settle(); }); await act(settle);
}
it('proposes the global default for both GitHub and HTTPS Git, then saves the reviewed repository revision', async () => {
  const view = await mount();
  try {
    expect(document.body.textContent).toContain('Global default · @bob');
    expect(document.querySelector('input[type=checkbox]')).toHaveProperty('checked', true);
    expect(document.querySelector('.github-setup-summary')?.textContent).toContain('@bob · OpenTig');
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
    await click('Add repository');
    expect(calls.setRepositoryAccount).toHaveBeenCalledWith('new', { mode: 'account', host: 'github.com', login: 'bob', useGlobalDefault: true, gitMode: 'managed' }, 3);
    expect(view.added).toHaveBeenCalledWith(repository);
    expect(calls.completeSetup).toHaveBeenCalledWith(repository.id, 3);
    expect(view.close).not.toHaveBeenCalled();
  } finally { await view.dispose(); }
});
it.each([true, false])('preserves a saved external choice, including shared worktrees (new=%s)', async isNew => {
  calls.repositoryAccount.mockResolvedValue({ ...unchecked, selection: { mode: 'account', host: 'github.com', login: 'alice', gitMode: 'external' } });
  const view = await mount(isNew);
  try {
    expect(document.querySelector('input[type=checkbox]')).toHaveProperty('checked', false);
    expect(document.querySelector('#setup-github-account')?.textContent).toContain('@alice');
    await click('Cancel'); expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
  } finally { await view.dispose(); }
});
it('does not silently enable managed Git on an existing unpinned repository', async () => {
  const view = await mount(false);
  try { expect(document.querySelector('input[type=checkbox]')).toHaveProperty('checked', false); }
  finally { await view.dispose(); }
});
it('keeps SSH external without attributing its identity to the GitHub account', async () => {
  calls.repositoryAccount.mockResolvedValue({ ...unchecked, access: { ...unchecked.access, publication: { ...unchecked.access!.publication, urls: ['git@github.com:org/demo.git'] } } });
  const view = await mount();
  try {
    expect(document.querySelector('input[type=checkbox]')).toHaveProperty('disabled', true);
    expect(document.querySelector('input[type=checkbox]')).toHaveProperty('checked', false);
    expect(document.querySelector('.github-setup-summary')?.textContent).toContain('Fetch / push: Existing credentials');
    await click('Add repository'); expect(calls.setRepositoryAccount.mock.calls[0]?.[1].gitMode).toBe('external');
  } finally { await view.dispose(); }
});
it('keeps the dialog open for stale choices and failed access checks', async () => {
  calls.setRepositoryAccount.mockRejectedValue(new Error('The global default changed. Review it again.'));
  const view = await mount();
  try {
    await click('Add repository'); expect(view.close).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toContain('global default changed');
    calls.setRepositoryAccount.mockResolvedValue(unchecked);
    calls.repositoryAccount.mockResolvedValue({ ...unchecked, state: 'error', message: 'Reconnect @bob.' });
    await click('Add repository'); expect(view.close).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Reconnect @bob');
    await click('Cancel'); expect(view.close).toHaveBeenCalledOnce(); expect(calls.completeSetup).not.toHaveBeenCalled();
  } finally { await view.dispose(); }
});
it('requires explicit completion with external authentication when no accounts are available', async () => {
  calls.accountsStatus.mockResolvedValue({ ...inventory, defaultLogin: null, activeLogin: null, accounts: [], message: 'GitHub CLI is unavailable.' });
  const view = await mount();
  try {
    expect([...document.querySelectorAll('button')].find(node => node.textContent === 'Add repository')).toHaveProperty('disabled', false);
    expect(document.querySelector('.github-setup-summary')?.textContent).toContain('Existing credentials');
    await click('Add an account'); expect(document.body.textContent).toContain('Manage accounts');
    await click('Back to repository setup');
    await click('Cancel'); expect(view.close).toHaveBeenCalledOnce(); expect(calls.completeSetup).not.toHaveBeenCalled();
    expect(calls.setRepositoryAccount).not.toHaveBeenCalled();
  } finally { await view.dispose(); }
});
it('cancels without adding while the account check is still pending', async () => {
  calls.accountsStatus.mockImplementation(() => new Promise(() => undefined));
  const view = await mount();
  try { await click('Cancel'); expect(view.close).toHaveBeenCalledOnce(); expect(calls.completeSetup).not.toHaveBeenCalled(); }
  finally { await view.dispose(); }
});
it.each(['git@github.com:org/demo.git', 'https://other.example/org/demo', 'https://github.com/org/demo?token=secret', 'https://github.com@other.example/org/demo'])('does not enable managed setup for %s', url => {
  expect(supportsManagedSetup([url])).toBe(false);
  expect(supportsManagedSetup(['https://github.com/org/a', 'https://github.com/org/b'])).toBe(false);
});

it('does not close as successful if another session changes the choice during verification', async () => {
  const view = await mount();
  try {
    calls.repositoryAccount.mockResolvedValue({ ...unchecked, revision: 9 });
    await click('Add repository');
    expect(view.close).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toContain('changed during the check');
  } finally { await view.dispose(); }
});

it('adds only after saving and checking the chosen account', async () => {
  let resolveCheck!: (value: GitHubRepositoryAccount) => void;
  const view = await mount();
  try {
    calls.repositoryAccount.mockImplementation(() => new Promise(resolve => { resolveCheck = resolve; }));
    await click('Add repository');
    expect(calls.completeSetup).not.toHaveBeenCalled();
    expect(view.added).not.toHaveBeenCalled();
    await act(async () => { resolveCheck({ ...unchecked, state: 'ready' }); await settle(); });
    expect(calls.completeSetup).toHaveBeenCalledOnce();
    expect(view.added).toHaveBeenCalledWith(repository);
  } finally { await view.dispose(); }
});
it('keeps the setup open when final registration fails or is stale', async () => {
  calls.completeSetup.mockRejectedValue(new Error('The repository account changed. Reload setup.'));
  const view = await mount();
  try {
    await click('Add repository');
    expect(view.added).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toContain('changed');
  } finally { await view.dispose(); }
});
it('can explicitly finish with external authentication without a GitHub check', async () => {
  calls.accountsStatus.mockResolvedValue({ ...inventory, accounts: [], activeLogin: null, defaultLogin: null });
  const view = await mount();
  try {
    expect(calls.completeSetup).not.toHaveBeenCalled();
    await click('Add repository');
    expect(calls.setRepositoryAccount).toHaveBeenCalledWith(repository.id, { mode: 'auto' }, 3);
    expect(calls.repositoryAccount).not.toHaveBeenCalledWith(repository.id, true);
    expect(view.added).toHaveBeenCalledWith(repository);
  } finally { await view.dispose(); }
});
it('does not register after failed account loading', async () => {
  calls.accountsStatus.mockRejectedValue(new Error('Unavailable'));
  const view = await mount();
  try {
    expect(document.body.textContent).toContain('Could not load repository access');
    await click('Cancel');
    expect(calls.completeSetup).not.toHaveBeenCalled(); expect(view.added).not.toHaveBeenCalled();
  } finally { await view.dispose(); }
});
it('preserves the Git authentication draft when managing accounts', async () => {
  const view = await mount();
  try {
    await act(async () => { (document.querySelector('input[type=checkbox]') as HTMLInputElement).click(); });
    await click('Add an account'); await click('Back to repository setup');
    expect(document.querySelector('input[type=checkbox]')).toHaveProperty('checked', false);
    await click('Add repository');
    expect(calls.setRepositoryAccount.mock.calls[0]?.[1].gitMode).toBe('external');
  } finally { await view.dispose(); }
});
