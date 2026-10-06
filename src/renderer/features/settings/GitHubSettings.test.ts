// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '@shared/contracts';
import type { GitHubAccountsStatus, GitHubRepositoryAccount } from '@shared/github-accounts';
import { GitHubSettings } from './GitHubSettings';

const calls = vi.hoisted(() => ({ accountsStatus: vi.fn(), repositoryAccount: vi.fn(), setRepositoryAccount: vi.fn(), error: vi.fn(), copy: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: calls } }));
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div'); document.body.append(container);
  let root = createRoot(container);
  const render = () => root.render(createElement(QueryClientProvider, { client }, createElement(GitHubSettings, { repository })));
  await act(async () => { render(); await settle(); }); await act(settle);
  return { container,
    reopen: async () => { await act(async () => root.unmount()); root = createRoot(container); await act(async () => { render(); await settle(); }); await act(settle); },
    close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); },
  };
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  expect(button).toBeDefined();
  await act(async () => { button!.click(); await settle(); }); await act(settle);
}

it('opens and reopens saved accounts without authentication checks and distinguishes both identities', async () => {
  calls.accountsStatus.mockResolvedValue(saved); calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    expect(view.container.textContent).toContain('Active in gh');
    expect(view.container.querySelector('.github-effective-account')?.textContent).toContain('@bob');
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
    await click('Check status');
    expect(view.container.textContent).toContain('Checking…');
    expect(view.container.textContent).toContain(saved.version);
    await act(async () => { release({ ...saved, checkedAt: '2026-10-07T10:00:00.000Z' }); await settle(); }); await act(settle);
    expect(calls.accountsStatus).toHaveBeenLastCalledWith(true);
    expect(calls.repositoryAccount).toHaveBeenLastCalledWith('repo', true);
    expect(view.container.querySelector('.github-effective-account')?.textContent).toContain('@alice');
    expect(view.container.textContent).toContain('07/10/2026');
  } finally { await view.close(); }
});

it('guides external login without running it and offers a voluntary global restore command', async () => {
  calls.accountsStatus.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, activeLogin: 'carol', accounts: [...saved.accounts,
    { host: 'github.com', login: 'carol', active: true, state: 'authenticated', storage: 'keyring' }] });
  calls.repositoryAccount.mockResolvedValue(context);
  const view = await mount();
  try {
    await click('Add account');
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
    await click('Check status');
    expect(view.container.textContent).toContain(saved.version);
    expect(calls.error).toHaveBeenCalledWith(expect.objectContaining({ description: 'Disconnected' }));
  } finally { await view.close(); }
});
