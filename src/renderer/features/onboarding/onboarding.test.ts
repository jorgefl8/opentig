// @vitest-environment jsdom
import { act, createElement, type FunctionComponent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerDirectoryListing } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Welcome } from '@/features/repositories/Welcome';
import { CloneRepositoryDialog } from './CloneRepositoryDialog';
import { GettingStartedChecklist } from './GettingStartedChecklist';
import { findRepositories } from './find-repositories';
import { joinFolder, needsIdentity } from './onboarding-model';

const api = vi.hoisted(() => ({
  app: { gitStatus: vi.fn(), setGlobalGitIdentity: vi.fn() },
  ai: { statuses: vi.fn() },
  github: { status: vi.fn() },
  commits: { authorship: vi.fn(), setAuthorship: vi.fn() },
  repository: { clone: vi.fn(), cloneStatus: vi.fn(), cancelClone: vi.fn(), browseDirectories: vi.fn(), favicon: vi.fn() },
}));
vi.mock('@/lib/opentig-api', () => ({ opentig: api }));
vi.mock('@/features/repositories/useRepositoryFavicons', () => ({ useRepositoryFavicons: () => new Map() }));

let root: Root, container: HTMLDivElement;
const text = () => document.body.textContent ?? '';
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim().startsWith(name))!;
const click = async (name: string) => { await act(async () => button(name).click()); };
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const render = <Props extends object>(element: (props: Props) => ReactNode, props: Props) => act(async () => root.render(createElement(TooltipProvider, null, createElement(element as FunctionComponent<Props>, props))));
const preferences = { commitMessageHarness: 'claude' } as never;
const listing = (path: string, directories: ServerDirectoryListing['directories'] = []): ServerDirectoryListing => ({ path, parentPath: null, repository: null, locations: [], directories });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  api.app.gitStatus.mockResolvedValue({ state: 'ready', platform: 'linux', version: '2.47.0' });
  api.github.status.mockResolvedValue({ installed: true, availability: 'ready', authStatus: 'authenticated' });
  api.ai.statuses.mockResolvedValue([{ id: 'claude', installed: true, authStatus: 'authenticated', availability: 'ready' }, { id: 'codex', installed: false, authStatus: 'unknown', availability: 'error' }]);
  sessionStorage.clear(); localStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('start screen', () => {
  const props = { recent: [], preferences, onPreference: vi.fn(), onOpen: vi.fn(), onClone: vi.fn(), onFind: vi.fn(), onRecent: vi.fn(), onSettings: vi.fn() };

  it('offers open, clone and find once Git is ready, with optional tools on one line', async () => {
    await render(Welcome, props); await settle();
    expect(button('Open a folder').disabled).toBe(false);
    await click('Clone from URL');
    expect(props.onClone).toHaveBeenCalled();
    expect(text()).toContain('2.47.0');
    expect(text()).toContain('signed in');
    expect(text()).toContain('Claude Code');
  });

  it('lists every AI assistant with what was detected', async () => {
    await render(Welcome, props); await settle();
    const trigger = document.querySelector<HTMLElement>('[aria-label="AI assistant"]')!;
    await act(async () => { trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); trigger.click(); });
    const items = [...document.querySelectorAll('[data-slot="select-item"]')].map(node => [node.textContent, node.hasAttribute('data-disabled')]);
    expect(items).toEqual([['CodexNot installed', true], ['Claude CodeDetected', false], ['OpenCodeNot checked', true], ['Grok BuildNot checked', true]]);
  });

  it('replaces the actions with install help when Git is missing and recovers on recheck', async () => {
    api.app.gitStatus.mockResolvedValueOnce({ state: 'missing', platform: 'linux' });
    await render(Welcome, props); await settle();
    expect(text()).toContain('Git isn’t installed yet');
    expect(text()).toContain('sudo apt install git');
    expect(button('Open a folder')).toBeUndefined();
    await click('Fedora');
    expect(text()).toContain('sudo dnf install git');
    await click('Check again'); await settle();
    expect(button('Open a folder').disabled).toBe(false);
  });

  it('never blocks on optional tools and links them to settings', async () => {
    api.github.status.mockResolvedValue({ installed: false, availability: 'error', authStatus: 'unknown' });
    api.ai.statuses.mockResolvedValue([]);
    await render(Welcome, props); await settle();
    expect(button('Open a folder').disabled).toBe(false);
    expect(text()).toContain('not installed');
    expect(text()).toContain('none found');
    await click('Set up');
    expect(props.onSettings).toHaveBeenCalledWith('github');
  });
});

describe('clone dialog', () => {
  const repository = { id: 'r', name: 'payments', repositoryName: 'payments', path: '/home/me/code/payments', commonDir: '/home/me/code/payments/.git' };
  const job = (patch: object) => ({ id: 'job', name: 'payments', destination: '/home/me/code/payments', state: 'running', phase: 'Receiving objects', percent: 40, received: '3.00 MiB', repository: null, error: null, ...patch });
  const mount = async (onCloned = vi.fn().mockResolvedValue(undefined), onOpenChange = vi.fn()) => {
    await render(CloneRepositoryDialog, { open: true, onOpenChange, defaultParent: '/home/me/code', onBrowse: vi.fn(), onCloned });
    return { onCloned, onOpenChange };
  };
  const field = (id: string) => document.getElementById(id) as HTMLInputElement;
  const submit = () => act(async () => { field('clone-url').form!.requestSubmit(); });

  it('derives the folder, shows the host, clones as a job and opens the result', async () => {
    api.repository.clone.mockResolvedValue(job({}));
    api.repository.cloneStatus.mockResolvedValueOnce(job({})).mockResolvedValueOnce(job({ state: 'completed', percent: 100, repository }));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const { onCloned, onOpenChange } = await mount();
      await input(field('clone-url'), 'git@github.com:acme/payments.git');
      expect(text()).toContain('GitHub · SSH');
      expect(text()).toContain('/home/me/code/payments');
      await submit();
      expect(api.repository.clone).toHaveBeenCalledWith({ url: 'git@github.com:acme/payments.git', parentPath: '/home/me/code', folderName: 'payments' });
      expect(text()).toContain('Cloning payments');
      expect(text()).toContain('3.00 MiB');
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(onCloned).toHaveBeenCalledWith(repository);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(localStorage.getItem('opentig.cloneParent')).toBe('/home/me/code');
    } finally { vi.useRealTimers(); }
  });

  it('keeps the form and explains a failure', async () => {
    api.repository.clone.mockResolvedValue(job({}));
    api.repository.cloneStatus.mockResolvedValue(job({ state: 'failed', error: 'Repository not found. Check the URL.' }));
    const { onCloned } = await mount();
    await input(field('clone-url'), 'https://github.com/acme/missing.git');
    await submit(); await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Repository not found. Check the URL.');
    expect(field('clone-url').value).toBe('https://github.com/acme/missing.git');
    expect(onCloned).not.toHaveBeenCalled();
  });

  it('rejects credentials in the URL before contacting the server', async () => {
    await mount();
    await input(field('clone-url'), 'https://user:token@github.com/acme/payments.git');
    await submit();
    expect(api.repository.clone).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('without embedded credentials');
  });
});

describe('getting started checklist', () => {
  const repository = { id: 'r', name: 'payments', repositoryName: 'payments', path: '/p', commonDir: '/p/.git' };
  const unset = { author: null, committer: null, source: 'unset', editable: true, blockers: [], revision: 'a'.repeat(64) };
  const mount = async (props = {}) => {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const client = new QueryClient();
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(GettingStartedChecklist, { repository, onDismiss: vi.fn(), onSettings: vi.fn(), ...props }))));
    await settle();
  };

  it('sets a global identity when none exists', async () => {
    api.commits.authorship.mockResolvedValueOnce(unset).mockResolvedValueOnce({ ...unset, author: { name: 'Ana', email: 'ana@acme.dev' }, committer: { name: 'Ana', email: 'ana@acme.dev' }, source: 'global' });
    await mount();
    expect(text()).toContain('2 of 3');
    await input(document.querySelector('input[aria-label="Name"]')!, 'Ana');
    await input(document.querySelector('input[aria-label="Email"]')!, 'ana@acme.dev');
    await click('All repositories'); await settle();
    expect(api.app.setGlobalGitIdentity).toHaveBeenCalledWith({ name: 'Ana', email: 'ana@acme.dev' });
    expect(text()).toContain('3 of 3');
    expect(text()).toContain('You’re ready to commit');
  });

  it('lets GitHub be skipped and dismisses when done', async () => {
    const onDismiss = vi.fn();
    api.commits.authorship.mockResolvedValue({ ...unset, author: { name: 'A', email: 'a@b.c' }, committer: { name: 'A', email: 'a@b.c' }, source: 'global' });
    api.github.status.mockResolvedValue({ installed: true, availability: 'ready', authStatus: 'unauthenticated' });
    await mount({ onDismiss });
    expect(text()).toContain('gh auth login');
    await click('Skip');
    await click('Done');
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('onboarding helpers', () => {
  it('finds repositories in common folders and skips known ones', async () => {
    const tree: Record<string, ServerDirectoryListing> = {
      home: listing('/home/me', [{ name: 'dotfiles', path: '/home/me/dotfiles', repository: { branch: 'main' } }, { name: 'code', path: '/home/me/code', repository: null }, { name: 'Music', path: '/home/me/Music', repository: null }]),
      '/home/me/code': listing('/home/me/code', [{ name: 'api', path: '/home/me/code/api', repository: { branch: 'main' } }, { name: 'client', path: '/home/me/code/client', repository: null }, { name: 'known', path: '/home/me/code/known', repository: { branch: 'dev' } }]),
      '/home/me/code/client': listing('/home/me/code/client', [{ name: 'web', path: '/home/me/code/client/web', repository: { branch: null } }]),
    };
    const browse = vi.fn(async (path?: string) => tree[path ?? 'home']!);
    const found = await findRepositories(browse, ['/home/me/code/known']);
    expect(found.map(item => item.path).sort()).toEqual(['/home/me/code/api', '/home/me/code/client/web', '/home/me/dotfiles']);
    expect(browse).not.toHaveBeenCalledWith('/home/me/Music');
  });

  it('also looks next to repositories already added inside the home folder', async () => {
    const tree: Record<string, ServerDirectoryListing> = {
      home: listing('/home/me', [{ name: 'clients', path: '/home/me/clients', repository: null }]),
      '/home/me/clients': listing('/home/me/clients', [{ name: 'payments', path: '/home/me/clients/payments', repository: { branch: 'main' } }, { name: 'billing', path: '/home/me/clients/billing', repository: { branch: 'main' } }]),
    };
    const browse = vi.fn(async (path?: string) => tree[path ?? 'home'] ?? listing(path!));
    const found = await findRepositories(browse, ['/home/me/clients/payments', '/tmp/scratch/demo', '/home/me/.cache/checkouts/payments/feature']);
    expect(found.map(item => item.path)).toEqual(['/home/me/clients/billing']);
    expect(browse).not.toHaveBeenCalledWith('/tmp/scratch');
    expect(browse).not.toHaveBeenCalledWith('/home/me/.cache/checkouts/payments');
  });

  it('treats a guessed identity as missing and joins server paths', () => {
    expect(needsIdentity({ author: { name: 'me', email: 'me@host.(none)' }, committer: { name: 'me', email: 'me@host.(none)' }, source: 'inferred', editable: true, blockers: [], revision: '' })).toBe(true);
    expect(joinFolder('C:\\Users\\me\\code\\', 'app')).toBe('C:\\Users\\me\\code\\app');
    expect(joinFolder('/home/me/code/', 'app')).toBe('/home/me/code/app');
  });
});
