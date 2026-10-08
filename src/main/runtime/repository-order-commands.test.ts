import { expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import { CommandRegistry } from './CommandRegistry';
import type { OpenTigHost } from './OpenTigHost';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { registerServerCommands } from './registerServerCommands';

it('validates ordering requests before invoking persistence and returns the saved organization', async () => {
  const organization = { repositoryProjects: [], recentRepositories: [] };
  const moveRepositoryProject = vi.fn().mockReturnValue(organization);
  const moveRepository = vi.fn().mockReturnValue(organization);
  const registry = new CommandRegistry();
  registerServerCommands(registry, { settings: { moveRepositoryProject, moveRepository } } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
  for (const command of [IPC.projectMove, IPC.projectMoveRepository]) {
    for (const index of [-1, 1.5, NaN, Infinity, '1', null]) {
      expect(await registry.execute('test', command, ['known', index])).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(await registry.execute('test', command, ['', 0])).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  }
  expect(moveRepositoryProject).not.toHaveBeenCalled();
  expect(moveRepository).not.toHaveBeenCalled();
  expect(await registry.execute('test', IPC.projectMove, ['project', 2])).toEqual({ ok: true, value: organization });
  expect(await registry.execute('test', IPC.projectMoveRepository, ['/sample/atlas/.git', 1])).toEqual({ ok: true, value: organization });
  expect(moveRepositoryProject).toHaveBeenCalledExactlyOnceWith('project', 2);
  expect(moveRepository).toHaveBeenCalledExactlyOnceWith('/sample/atlas/.git', 1);
});
