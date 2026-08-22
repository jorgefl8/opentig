import { describe, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '../../shared/contracts';
import { IPC } from '../../shared/contracts';
import { GitOperationError } from '../../shared/errors';
import { OPEN_TIG_SERVER_COMMANDS } from '../../shared/protocol';
import { CommandRegistry } from './CommandRegistry';

const repository = (path: string, sequence: number): RepositoryInfo => ({
  id: `repo-${sequence}`,
  name: 'main',
  repositoryName: 'repo',
  path,
  commonDir: `${path}\\.git`,
});

describe('CommandRegistry', () => {
  it('executes a typed command and isolates mutable state by session', async () => {
    const registry = new CommandRegistry();
    registry.register(OPEN_TIG_SERVER_COMMANDS['repository.openPath'], (context, [path]) => {
      const state = context.state('sequence', () => ({ value: 0 }));
      state.value += 1;
      return repository(path, state.value);
    });

    await expect(registry.execute('first', IPC.repositoryOpenPath, ['C:\\one'])).resolves.toMatchObject({
      ok: true,
      value: { id: 'repo-1' },
    });
    await expect(registry.execute('first', IPC.repositoryOpenPath, ['C:\\two'])).resolves.toMatchObject({
      ok: true,
      value: { id: 'repo-2' },
    });
    await expect(registry.execute('second', IPC.repositoryOpenPath, ['C:\\three'])).resolves.toMatchObject({
      ok: true,
      value: { id: 'repo-1' },
    });
  });

  it('returns stable errors for unknown commands and malformed arguments', async () => {
    const registry = new CommandRegistry();
    registry.register(OPEN_TIG_SERVER_COMMANDS['repository.openPath'], (_context, [path]) => repository(path, 1));

    await expect(registry.execute('session', 'missing:command', [])).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', operation: 'command', message: 'Unknown server command.' },
    });
    await expect(registry.execute('session', IPC.repositoryOpenPath, 'C:\\repo')).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', operation: 'open-path', message: 'Command arguments must be an array.' },
    });
  });

  it('rejects oversized requests before invoking their handler', async () => {
    const registry = new CommandRegistry();
    const handler = vi.fn((_context, [path]: [string]) => repository(path, 1));
    registry.register(OPEN_TIG_SERVER_COMMANDS['repository.openPath'], handler);

    const result = await registry.execute(
      'session',
      IPC.repositoryOpenPath,
      ['x'.repeat(OPEN_TIG_SERVER_COMMANDS['repository.openPath'].maxRequestBytes + 1)],
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', operation: 'open-path' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('counts typed-array payloads by binary bytes instead of JSON expansion', async () => {
    const registry = new CommandRegistry();
    const definition = { ...OPEN_TIG_SERVER_COMMANDS['repository.pasteEntries'], maxRequestBytes: 512 };
    const handler = vi.fn(() => ({ status: 'empty' as const, created: [] as [] }));
    registry.register(definition, handler);

    const accepted = new Uint8Array(128);
    await expect(registry.execute('session', IPC.repositoryPasteEntries, ['repo', '', [], null, accepted])).resolves.toMatchObject({ ok: true });
    expect(handler).toHaveBeenCalledOnce();

    const oversized = new Uint8Array(600);
    await expect(registry.execute('session', IPC.repositoryPasteEntries, ['repo', '', [], null, oversized])).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', operation: 'paste-entries' },
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('preserves operation errors from command handlers', async () => {
    const registry = new CommandRegistry();
    registry.register(OPEN_TIG_SERVER_COMMANDS['repository.openPath'], () => {
      throw new GitOperationError({
        code: 'NOT_REPOSITORY',
        operation: 'open-path',
        message: 'Not a Git repository.',
      });
    });

    await expect(registry.execute('session', IPC.repositoryOpenPath, ['C:\\invalid'])).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_REPOSITORY', operation: 'open-path', message: 'Not a Git repository.' },
    });
  });
});
