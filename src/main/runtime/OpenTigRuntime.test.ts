import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenTigRuntimeEvent } from '../../shared/runtime-events';
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
  const settings = {
    activeRepositoryId,
    flush: vi.fn(async () => undefined),
  };
  const services = {
    watcher,
    prDrafts,
    fileHistory,
    ai,
    cliRunner,
    git,
    aiLog,
    problems,
    settings,
  } as unknown as OpenTigRuntimeServices;
  return { services, watcher, prDrafts, fileHistory, ai, cliRunner, git, aiLog, problems, settings };
}

describe('OpenTigRuntime', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces repository events without consulting window visibility', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const events: OpenTigRuntimeEvent[] = [];
    const runtime = new OpenTigRuntime(fixture().services, (event) => events.push(event));

    runtime.publishRepositoryChange('repo-id', 'worktree');
    vi.setSystemTime(10_100);
    runtime.publishRepositoryChange('repo-id', 'index');
    runtime.publishRepositoryChange('repo-id', 'refs');

    expect(events).toEqual([{ type: 'repository.changed', repositoryId: 'repo-id', scope: 'worktree' }]);
    vi.advanceTimersByTime(900);
    expect(events).toEqual([
      { type: 'repository.changed', repositoryId: 'repo-id', scope: 'worktree' },
      { type: 'repository.changed', repositoryId: 'repo-id', scope: 'unknown' },
    ]);
  });

  it('refreshes the active repository only after the stale interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const sink = vi.fn();
    const runtime = new OpenTigRuntime(fixture().services, sink);

    runtime.publishRepositoryChange('repo-id', 'index');
    vi.setSystemTime(11_000);
    runtime.refreshActiveRepositoryIfStale();
    vi.setSystemTime(12_001);
    runtime.refreshActiveRepositoryIfStale();

    expect(sink).toHaveBeenNthCalledWith(1, {
      type: 'repository.changed', repositoryId: 'repo-id', scope: 'index',
    });
    expect(sink).toHaveBeenNthCalledWith(2, {
      type: 'repository.changed', repositoryId: 'repo-id', scope: 'unknown',
    });
  });

  it('broadcasts active repository changes as typed runtime events', () => {
    const sink = vi.fn();
    const runtime = new OpenTigRuntime(fixture().services, sink);
    const repository = {
      id: 'repo-id', name: 'main', repositoryName: 'repo', path: 'C:\\repo', commonDir: 'C:\\repo\\.git',
    };

    runtime.publishActiveRepositoryChange(repository);

    expect(sink).toHaveBeenCalledWith({ type: 'repository.active-changed', repository });
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
    expect(state.settings.flush).toHaveBeenCalledOnce();
  });
});
