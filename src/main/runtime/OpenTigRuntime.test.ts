import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { OpenTigRuntime } from './OpenTigRuntime';

function fixture(activeRepositoryId: string | null = 'repo-id') {
  const watcher = { stop: vi.fn() };
  const prDrafts = { close: vi.fn() };
  const fileHistory = { clear: vi.fn() };
  const ai = { close: vi.fn(async () => undefined) };
  const cliRunner = { close: vi.fn(async () => undefined) };
  const git = { close: vi.fn(async () => undefined) };
  const aiLog = { flush: vi.fn(async () => undefined) };
  const problems = { flush: vi.fn(async () => undefined) };
  const github = { cache: { close: vi.fn(async () => undefined) } };
  const settings = {
    activeRepositoryId,
    flush: vi.fn(async () => undefined),
  };
  // Every repository's changes go to one connection, as if it had them all open.
  const clients = {
    changed: vi.fn(),
    watchChanged: vi.fn(),
  };
  const services = {
    repositories: { invalidateIfKnown: vi.fn() },
    watcher,
    clients,
    prDrafts,
    fileHistory,
    ai,
    cliRunner,
    git,
    aiLog,
    problems,
    github,
    settings,
  } as unknown as OpenTigRuntimeServices;
  return { services, watcher, clients, prDrafts, fileHistory, ai, cliRunner, git, aiLog, problems, github, settings };
}

describe('OpenTigRuntime', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces each repository’s changes on its own, so one repository never swallows another’s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const state = fixture();
    const runtime = new OpenTigRuntime(state.services, vi.fn());

    runtime.publishRepositoryChange('repo-a', 'worktree');
    runtime.publishRepositoryChange('repo-b', 'index');
    vi.setSystemTime(10_100);
    runtime.publishRepositoryChange('repo-a', 'index');
    runtime.publishRepositoryChange('repo-b', 'refs');
    runtime.publishRepositoryChange('repo-a', 'refs');
    expect(state.services.repositories.invalidateIfKnown).toHaveBeenCalledTimes(5);
    expect(state.clients.changed.mock.calls).toEqual([['repo-a', 'worktree'], ['repo-b', 'index']]);

    vi.advanceTimersByTime(900);
    expect(state.clients.changed.mock.calls).toEqual([
      ['repo-a', 'worktree'], ['repo-b', 'index'],
      ['repo-a', 'unknown'], ['repo-b', 'refs'],
    ]);
  });

  it('hands a watch’s new state to the clients of that repository', () => {
    const state = fixture();
    const runtime = new OpenTigRuntime(state.services, vi.fn());
    runtime.publishRepositoryWatch('repo-a', 'watching', 'watch-1');
    expect(state.clients.watchChanged).toHaveBeenCalledExactlyOnceWith('repo-a', 'watching', 'watch-1');
    expect(state.services.repositories.invalidateIfKnown).toHaveBeenCalledWith('repo-a');
  });

  it('closes every owned resource exactly once', async () => {
    const state = fixture();
    const runtime = new OpenTigRuntime(state.services, vi.fn());

    const first = runtime.close();
    const second = runtime.close();

    expect(second).toBe(first);
    await first;
    expect(state.watcher.stop).toHaveBeenCalledOnce();
    expect(state.prDrafts.close).toHaveBeenCalledOnce();
    expect(state.fileHistory.clear).toHaveBeenCalledOnce();
    expect(state.ai.close).toHaveBeenCalledOnce();
    expect(state.cliRunner.close).toHaveBeenCalledOnce();
    expect(state.git.close).toHaveBeenCalledOnce();
    expect(state.aiLog.flush).toHaveBeenCalledOnce();
    expect(state.problems.flush).toHaveBeenCalledOnce();
    expect(state.github.cache.close).toHaveBeenCalledOnce();
    expect(state.settings.flush).toHaveBeenCalledOnce();
  });
});

it('broadcasts a default change to followers and their worktrees without affecting fixed clones', () => {
  const f = fixture(); const sink = vi.fn();
  f.services.repositories = { recents: () => [
    { id: 'follower', commonDir: '/fixture/shared/.git' },
    { id: 'worktree', commonDir: '/fixture/shared/.git' },
    { id: 'fixed', commonDir: '/fixture/clone/.git' },
  ] } as unknown as OpenTigRuntimeServices['repositories'];
  f.services.settings.githubAccount = commonDir => commonDir.includes('shared') ? { mode: 'default' } : { mode: 'account', host: 'github.com', login: 'alice' };
  const runtime = new OpenTigRuntime(f.services, sink);
  runtime.publishGitHubAccountsChange(undefined, true);
  expect(sink).toHaveBeenCalledExactlyOnceWith({ type: 'github.accounts-changed', repositoryIds: ['follower', 'worktree'], inventoryChanged: true });
});

it('broadcasts a repository account change and refreshed assignments to every connected client', () => {
  const f = fixture(); const firstClient = vi.fn(); const secondClient = vi.fn();
  f.services.repositories = { recents: () => [
    { id: 'repo', commonDir: '/fixture/shared/.git' },
    { id: 'worktree', commonDir: '/fixture/shared/.git' },
    { id: 'clone', commonDir: '/fixture/clone/.git' },
  ] } as typeof f.services.repositories;
  const runtime = new OpenTigRuntime(f.services, event => { firstClient(event); secondClient(event); });
  runtime.publishGitHubAccountsChange('/fixture/shared/.git');
  const event = { type: 'github.accounts-changed', repositoryIds: ['repo', 'worktree'], inventoryChanged: true };
  expect(firstClient).toHaveBeenCalledExactlyOnceWith(event);
  expect(secondClient).toHaveBeenCalledExactlyOnceWith(event);
});
