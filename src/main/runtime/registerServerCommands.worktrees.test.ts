import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import { CommandRegistry } from './CommandRegistry';
import { registerServerCommands } from './registerServerCommands';

const request = { repositoryId: 'repo', path: '/sample/review', expectedOid: 'a'.repeat(40), force: false, deleteBranch: true };

function fixture(removeWorktree: (...args: unknown[]) => Promise<unknown>, openElsewhere = false) {
  const registry = new CommandRegistry();
  const repositoryChanged = vi.fn();
  const clients = { openElsewhere: vi.fn(() => openElsewhere), forget: vi.fn() };
  registerServerCommands(registry, {
    clients,
    repositories: {
      invalidateIfKnown: vi.fn(),
      get: () => ({ id: 'repo', commonDir: '/sample/.git' }),
      recents: () => [{ id: 'repo', commonDir: '/sample/.git' }, { id: 'sibling', commonDir: '/sample/.git' }, { id: 'other', commonDir: '/other/.git' }],
    },
    operations: { removeWorktree },
    events: { repositoryChanged },
  } as unknown as Parameters<typeof registerServerCommands>[1], {} as Parameters<typeof registerServerCommands>[2]);
  return { registry, repositoryChanged, clients };
}

describe('worktree removal command', () => {
  it('passes the request signal, so a removal still waiting can be dropped', async () => {
    const removeWorktree = vi.fn(async () => ({ status: 'cancelled' }));
    const { registry } = fixture(removeWorktree);
    const { signal } = new AbortController();

    await registry.execute('session', IPC.worktreeRemove, [request], { signal });

    expect(removeWorktree).toHaveBeenCalledWith('repo', '/sample/review', 'a'.repeat(40), false, true, { signal });
  });

  it('passes a cleanup request through, separate from forcing a removal', async () => {
    const removeWorktree = vi.fn(async () => ({ status: 'stale' }));
    const { registry } = fixture(removeWorktree);

    await registry.execute('session', IPC.worktreeRemove, [{ ...request, force: false, deleteBranch: false, cleanupOnly: true }]);

    expect(removeWorktree).toHaveBeenCalledWith('repo', '/sample/review', 'a'.repeat(40), false, false, expect.objectContaining({ cleanupOnly: true }));
  });

  it('refuses to remove a worktree another tab, window or device has open, and leaves it alone', async () => {
    const removeWorktree = vi.fn(async () => ({ status: 'removed' }));
    const { registry, clients } = fixture(removeWorktree, true);

    expect(await registry.execute('session', IPC.worktreeRemove, [request], { connectionId: 'tab' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('open in another window') } });

    expect(clients.openElsewhere).toHaveBeenCalledWith('/sample/review', 'tab');
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it('tells every client when the removal ends, whether or not it succeeded', async () => {
    const { registry, repositoryChanged } = fixture(async () => { throw new Error('Refused.'); });

    expect(await registry.execute('session', IPC.worktreeRemove, [request])).toMatchObject({ ok: false });

    expect(repositoryChanged.mock.calls).toEqual([['repo', 'worktrees'], ['sibling', 'worktrees']]);
  });
});
