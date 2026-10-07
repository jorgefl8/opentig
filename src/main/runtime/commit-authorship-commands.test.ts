import { expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import { CommandRegistry } from './CommandRegistry';
import type { OpenTigHost } from './OpenTigHost';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { registerServerCommands } from './registerServerCommands';

it('validates authorship writes at the server boundary and notifies sibling worktrees only after saving', async () => {
  const result = { author: { name: 'Sample', email: 'sample@example.com' } };
  const setCommitAuthorship = vi.fn().mockResolvedValue(result);
  const repositoryChanged = vi.fn();
  const registry = new CommandRegistry();
  registerServerCommands(registry, {
    operations: { setCommitAuthorship },
    repositories: { get: () => ({ commonDir: '/fixture/shared.git' }), recents: () => [
      { id: 'main', commonDir: '/fixture/shared.git' }, { id: 'sibling', commonDir: '/fixture/shared.git' }, { id: 'other', commonDir: '/fixture/other.git' },
    ] }, events: { repositoryChanged },
  } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
  expect(await registry.execute('test', IPC.commitSetAuthorship, ['main', { name: 'Sample', email: 'invalid', expectedRevision: 'a'.repeat(64) }])).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  expect(setCommitAuthorship).not.toHaveBeenCalled();
  expect(repositoryChanged).not.toHaveBeenCalled();
  const input = { name: 'Sample', email: 'sample@example.com', expectedRevision: 'a'.repeat(64) };
  expect(await registry.execute('test', IPC.commitSetAuthorship, ['main', input])).toMatchObject({ ok: true, value: result });
  expect(setCommitAuthorship).toHaveBeenCalledExactlyOnceWith('main', input);
  expect(repositoryChanged.mock.calls).toEqual([['main', 'unknown'], ['sibling', 'unknown']]);
  repositoryChanged.mockClear(); setCommitAuthorship.mockRejectedValueOnce(new Error('Stale identity'));
  expect(await registry.execute('test', IPC.commitSetAuthorship, ['main', input])).toMatchObject({ ok: false });
  expect(repositoryChanged).not.toHaveBeenCalled();
});
