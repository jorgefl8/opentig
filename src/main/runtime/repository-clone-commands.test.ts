import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { IPC } from '../../shared/contracts';
import type { RunOptions } from '../git/GitProcess';
import { CommandRegistry } from './CommandRegistry';
import type { OpenTigRuntimeServices } from './OpenTigRuntime';
import type { OpenTigHost } from './OpenTigHost';
import { registerServerCommands } from './registerServerCommands';

const until = async (check: () => Promise<boolean>) => { for (let attempt = 0; attempt < 200 && !await check(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 5)); };

it('keeps a clone running after its request disconnects, refuses overlaps, and cancels on request', async () => {
  const parentPath = await mkdtemp(path.join(tmpdir(), 'opentig-clone-job-'));
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const preparePath = vi.fn();
  const git = { run: vi.fn(async (_cwd: string, _args: string[], options: RunOptions) => {
    started();
    await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
    throw new Error('Cancelled');
  }) };
  const registry = new CommandRegistry();
  registerServerCommands(registry, { git, repositories: { preparePath, invalidateIfKnown: vi.fn() } } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
  try {
    const input = { url: 'https://example.com/sample.git', folderName: 'sample', parentPath };
    const request = new AbortController();
    const started_ = await registry.execute('owner', IPC.repositoryClone, [input], { signal: request.signal });
    expect(started_).toMatchObject({ ok: true, value: { state: 'running', name: 'sample' } });
    const id = (started_ as { value: { id: string } }).value.id;
    await running;
    request.abort();
    // Another connection of the same user, e.g. after a reconnect, still sees the job.
    expect(await registry.execute('reconnected', IPC.repositoryCloneStatus, [id])).toMatchObject({ ok: true, value: { state: 'running' } });
    expect(await registry.execute('owner', IPC.repositoryClone, [{ ...input, folderName: 'other' }])).toMatchObject({ ok: false });
    await registry.execute('reconnected', IPC.repositoryCancelClone, [id]);
    await until(async () => (await registry.execute('owner', IPC.repositoryCloneStatus, [id]) as { value: { state: string } }).value.state !== 'running');
    expect(await registry.execute('owner', IPC.repositoryCloneStatus, [id])).toMatchObject({ ok: true, value: { state: 'cancelled', error: 'Clone cancelled.' } });
    expect(preparePath).not.toHaveBeenCalled();
  } finally { await rm(parentPath, { recursive: true, force: true }); }
});

it('reports the prepared repository when the clone completes', async () => {
  const parentPath = await mkdtemp(path.join(tmpdir(), 'opentig-clone-job-'));
  const repository = { id: 'r', name: 'sample', repositoryName: 'sample', path: path.join(parentPath, 'sample'), commonDir: path.join(parentPath, 'sample', '.git') };
  const registry = new CommandRegistry();
  registerServerCommands(registry, { git: { run: vi.fn().mockResolvedValue({}) }, repositories: { preparePath: vi.fn().mockResolvedValue(repository), invalidateIfKnown: vi.fn() } } as unknown as OpenTigRuntimeServices, {} as OpenTigHost);
  try {
    const result = await registry.execute('owner', IPC.repositoryClone, [{ url: 'git@example.com:org/sample.git', folderName: 'sample', parentPath }]) as { value: { id: string } };
    await until(async () => (await registry.execute('owner', IPC.repositoryCloneStatus, [result.value.id]) as { value: { state: string } }).value.state !== 'running');
    expect(await registry.execute('owner', IPC.repositoryCloneStatus, [result.value.id])).toMatchObject({ ok: true, value: { state: 'completed', percent: 100, repository } });
  } finally { await rm(parentPath, { recursive: true, force: true }); }
});
