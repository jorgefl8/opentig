import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import { CommandRegistry } from './CommandRegistry';
import type { OpenTigHost } from './OpenTigHost';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import { registerServerCommands } from './registerServerCommands';

describe('read invalidation at the command boundary', () => {
  it('invalidates filesystem mutations before and after success or failure without sharing writes', async () => {
    const order: string[] = [];
    const invalidateIfKnown = vi.fn((id: unknown) => { order.push(`invalidate:${id}`); });
    const write = vi.fn(async () => { order.push('write'); return { ok: true }; });
    const registry = new CommandRegistry();
    registerServerCommands(registry, { repositories: { invalidateIfKnown }, files: { write } } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
    const args = ['repo', 'file.txt', 'new', 'old'];
    expect(await registry.execute('one', IPC.repositoryWriteFile, args)).toMatchObject({ ok: true });
    expect(order).toEqual(['invalidate:repo', 'write', 'invalidate:repo']);
    order.length = 0;
    write.mockRejectedValueOnce(new Error('partially failed'));
    expect(await registry.execute('one', IPC.repositoryWriteFile, args)).toMatchObject({ ok: false });
    expect(order).toEqual(['invalidate:repo', 'invalidate:repo']);
    await Promise.all(Array.from({ length: 4 }, (_, index) => registry.execute(String(index), IPC.repositoryWriteFile, args)));
    expect(write).toHaveBeenCalledTimes(6);
  });

  it('names a fetch when it invalidates, so what ignores a fetch, as GitHub\'s reads do, goes on', async () => {
    const invalidateIfKnown = vi.fn();
    const fetch = vi.fn(async () => ({ status: 'success', ahead: 0, behind: 0 }));
    const write = vi.fn(async () => ({ ok: true }));
    const registry = new CommandRegistry();
    registerServerCommands(registry, { repositories: { invalidateIfKnown }, operations: { fetch }, files: { write } } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
    expect(await registry.execute('one', IPC.refsFetch, ['repo'])).toMatchObject({ ok: true });
    expect(invalidateIfKnown.mock.calls).toEqual([['repo', 'fetch'], ['repo', 'fetch']]);
    invalidateIfKnown.mockClear();
    await registry.execute('one', IPC.repositoryWriteFile, ['repo', 'file.txt', 'new', 'old']);
    expect(invalidateIfKnown.mock.calls).toEqual([['repo', undefined], ['repo', undefined]]);
  });

  it('does not invalidate reads when one consumer has disconnected', async () => {
    const invalidateIfKnown = vi.fn();
    const status = vi.fn(async () => ({ branch: 'main' }));
    const registry = new CommandRegistry();
    registerServerCommands(registry, { repositories: { invalidateIfKnown, status } } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
    const aborted = new AbortController();
    aborted.abort();
    const values = await Promise.all([
      registry.execute('gone', IPC.repositoryStatus, ['repo'], { signal: aborted.signal }),
      registry.execute('present', IPC.repositoryStatus, ['repo']),
    ]);
    expect(values.every(value => value.ok)).toBe(true);
    expect(invalidateIfKnown).not.toHaveBeenCalled();
  });
});
