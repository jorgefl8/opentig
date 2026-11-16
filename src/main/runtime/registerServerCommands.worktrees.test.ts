import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import { CommandRegistry } from './CommandRegistry';
import { registerServerCommands } from './registerServerCommands';

const request = { repositoryId: 'repo', path: '/sample/review', expectedOid: 'a'.repeat(40), force: false, deleteBranch: true };

function fixture(removeWorktree: (...args: unknown[]) => Promise<unknown>) {
  const registry = new CommandRegistry();
  const repositoryChanged = vi.fn();
  const clients = { move: vi.fn(), forget: vi.fn(), repositoryOf: vi.fn((): string | null => null) };
  const watcher = { pause: vi.fn(async () => undefined), endPause: vi.fn() };
  registerServerCommands(registry, {
    clients,
    watcher,
    repositories: {
      invalidateIfKnown: vi.fn(),
      get: (id: string) => ({ id, commonDir: '/sample/.git', path: id === 'review' ? '/sample/review' : '/sample' }),
      isKnown: () => true,
      recents: () => [{ id: 'repo', commonDir: '/sample/.git' }, { id: 'sibling', commonDir: '/sample/.git' }, { id: 'other', commonDir: '/other/.git' }],
    },
    operations: { removeWorktree },
    events: { repositoryChanged },
  } as unknown as Parameters<typeof registerServerCommands>[1], {} as Parameters<typeof registerServerCommands>[2]);
  return { registry, repositoryChanged, clients, watcher };
}

describe('worktree removal command', () => {
  it('passes the request signal, so a removal still waiting can be dropped', async () => {
    const removeWorktree = vi.fn(async () => ({ status: 'cancelled' }));
    const { registry } = fixture(removeWorktree);
    const { signal } = new AbortController();

    await registry.execute('session', IPC.worktreeRemove, [request], { signal });

    expect(removeWorktree).toHaveBeenCalledWith('repo', '/sample/review', 'a'.repeat(40), false, true, expect.objectContaining({ signal }));
  });

  it('passes a cleanup request through, separate from forcing a removal', async () => {
    const removeWorktree = vi.fn(async () => ({ status: 'stale' }));
    const { registry } = fixture(removeWorktree);

    await registry.execute('session', IPC.worktreeRemove, [{ ...request, force: false, deleteBranch: false, cleanupOnly: true }]);

    expect(removeWorktree).toHaveBeenCalledWith('repo', '/sample/review', 'a'.repeat(40), false, false, expect.objectContaining({ cleanupOnly: true }));
  });

  it('stops the watch of the folder before it is deleted, and watches it again when the removal fails', async () => {
    const { registry, watcher } = fixture(async (...args: unknown[]) => {
      await (args[5] as { beforeDelete(path: string): Promise<void> }).beforeDelete('/sample/review');
      throw new Error('The folder is in use.');
    });

    expect(await registry.execute('session', IPC.worktreeRemove, [request])).toMatchObject({ ok: false });

    expect(watcher.pause).toHaveBeenCalledExactlyOnceWith('/sample/review');
    expect(watcher.endPause).toHaveBeenCalledExactlyOnceWith('/sample/review');
  });

  it('asks which worktree the client is in only when the removal is decided, under its lock', async () => {
    let asked: string | undefined;
    const { registry, clients } = fixture(async (...args: unknown[]) => {
      // The client opened the worktree while the request waited for the lock.
      clients.repositoryOf.mockReturnValue('review');
      asked = (args[5] as { currentPath(): string | undefined }).currentPath();
      return { status: 'current' };
    });

    await registry.execute('session', IPC.worktreeRemove, [request], { connectionId: 'tab' });

    expect(asked).toBe('/sample/review');
  });

  it('tells every client when the removal ends, whether or not it succeeded', async () => {
    const { registry, repositoryChanged } = fixture(async () => { throw new Error('Refused.'); });

    expect(await registry.execute('session', IPC.worktreeRemove, [request])).toMatchObject({ ok: false });

    expect(repositoryChanged.mock.calls).toEqual([['repo', 'worktrees'], ['sibling', 'worktrees']]);
  });
});
