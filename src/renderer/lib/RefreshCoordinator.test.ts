import { describe, expect, it, vi } from 'vitest';
import { mergeRepositoryChangeScopes, type RepositoryChangeScope } from '../../shared/repository-change';
import { RefreshCoordinator, type RefreshRequest } from './RefreshCoordinator';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('RefreshCoordinator', () => {
  it('runs at most one batch plus one trailing batch for a burst', async () => {
    const first = deferred();
    const executions: Array<RefreshRequest<RepositoryChangeScope>> = [];
    const execute = vi.fn(async (request: RefreshRequest<RepositoryChangeScope>) => {
      executions.push(request);
      if (executions.length === 1) await first.promise;
    });
    const coordinator = new RefreshCoordinator(execute, mergeRepositoryChangeScopes);

    const initial = coordinator.request({ scope: 'worktree', background: true });
    const burst = Array.from({ length: 20 }, (_, index) => coordinator.request({
      scope: index === 19 ? 'refs' : 'worktree',
      background: true,
    }));
    expect(execute).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.all([initial, ...burst]);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(executions[1]).toEqual({ scope: 'unknown', background: true });
  });

  it('keeps the strongest foreground requirement in a trailing batch', async () => {
    const first = deferred();
    const executions: Array<RefreshRequest<RepositoryChangeScope>> = [];
    const coordinator = new RefreshCoordinator(async (request) => {
      executions.push(request);
      if (executions.length === 1) await first.promise;
    }, mergeRepositoryChangeScopes);

    const initial = coordinator.request({ scope: 'worktree', background: true });
    const background = coordinator.request({ scope: 'index', background: true });
    const foreground = coordinator.request({ scope: 'index', background: false });
    first.resolve();
    await Promise.all([initial, background, foreground]);

    expect(executions[1]).toEqual({ scope: 'index', background: false });
  });

  it('drops a queued batch when the repository is invalidated', async () => {
    const first = deferred();
    const execute = vi.fn(async () => { await first.promise; });
    const coordinator = new RefreshCoordinator(execute, mergeRepositoryChangeScopes);

    const active = coordinator.request({ scope: 'worktree', background: true });
    const queued = coordinator.request({ scope: 'refs', background: true });
    coordinator.invalidate();
    first.resolve();
    await Promise.all([active, queued]);

    expect(execute).toHaveBeenCalledOnce();
  });

  it('continues after an execution rejects', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new RefreshCoordinator(execute, mergeRepositoryChangeScopes);

    await expect(coordinator.request({ scope: 'worktree', background: true })).rejects.toThrow('failed');
    await expect(coordinator.request({ scope: 'worktree', background: true })).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
  });
});
