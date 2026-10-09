import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiHarnessStatus } from '../../shared/contracts';
import { CommitMessageService } from '../ai/CommitMessageService';
import type { AiProvider } from '../ai/types';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import { AiStatusStore } from './AiStatusStore';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const ready: AiHarnessStatus = {
  id: 'codex', label: 'Codex', availability: 'ready', installed: true, authStatus: 'authenticated',
  models: [{ id: 'default', label: 'Default' }, { id: 'model', label: 'Saved model' }], checkedAt: '2026-10-06T10:00:00.000Z', version: '1.0',
};
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-ai-status-'));
  directories.push(directory);
  const file = path.join(directory, 'ai-statuses.json');
  return { file, store: new AiStatusStore(file) };
}
function service(store: Pick<AiStatusStore, 'load' | 'save'>, status: AiProvider['status'], key: () => string = () => 'paths') {
  return new CommitMessageService({} as GitRepositoryOperations, [{ id: 'codex', status, generate: vi.fn() }], undefined, undefined, { store, key });
}

describe('saved AI status', () => {
  it('restores models and the last check across backend restarts without probing the CLI', async () => {
    const { store, file } = await fixture();
    const status = vi.fn(async () => ready);
    const checked = await service(store, status).statuses();
    expect(status).toHaveBeenCalledOnce();
    const afterRestart = vi.fn(async () => ({ ...ready, version: '2.0' }));
    const restarted = service(new AiStatusStore(file), afterRestart);
    expect(await restarted.statuses()).toEqual(checked);
    expect(afterRestart).not.toHaveBeenCalled();
    expect(await restarted.statuses(true)).toMatchObject([{ version: '2.0' }]);
    expect(afterRestart).toHaveBeenCalledExactlyOnceWith(true);
    expect(await new AiStatusStore(file).load('paths')).toMatchObject([{ version: '2.0' }]);
  });

  it('rejects old path identities and rechecks even when switching back to a saved path', async () => {
    const { store } = await fixture();
    await store.save('old', [ready]);
    let key = 'new';
    const status = vi.fn(async () => ready);
    const current = service(store, status, () => key);
    await current.statuses();
    expect(status).toHaveBeenCalledOnce();
    key = 'old';
    current.invalidateStatuses();
    await current.statuses();
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('recovers from missing, corrupt or incompatible cache files and keeps profiles separate', async () => {
    const dev = await fixture(), production = await fixture();
    await production.store.save('paths', [ready]);
    expect(await dev.store.load('paths')).toBeNull();
    for (const contents of ['broken JSON', JSON.stringify({ version: 99, key: 'paths', statuses: [ready] }), JSON.stringify({ version: 1, key: 'paths', statuses: [{ ...ready, checkedAt: 'invalid' }] })]) {
      await writeFile(dev.file, contents);
      expect(await dev.store.load('paths')).toBeNull();
    }
    const status = vi.fn(async () => ({ ...ready, version: 'Dev' }));
    expect(await service(dev.store, status).statuses()).toMatchObject([{ version: 'Dev' }]);
    expect(await production.store.load('paths')).toEqual([ready]);
  });

  it('persists only declared metadata, dropping credential-shaped extra fields', async () => {
    const { store, file } = await fixture();
    const supplied = { ...ready, apiKey: 'sample-secret', models: [{ id: 'default', label: 'Default', token: 'sample-token' }] };
    await store.save('paths', [supplied]);
    const saved = await readFile(file, 'utf8');
    expect(saved).not.toContain('sample-secret');
    expect(saved).not.toContain('sample-token');
    expect(await store.load('paths')).toMatchObject([{ checkedAt: ready.checkedAt }]);
  });

  it('keeps successful inspection usable when persistence is unavailable', async () => {
    const current = service({ load: vi.fn().mockRejectedValue(new Error('read denied')), save: vi.fn().mockRejectedValue(new Error('disk full')) }, async () => ready);
    expect(await current.statuses()).toMatchObject([{ availability: 'ready' }]);
    expect(await current.statuses()).toMatchObject([{ availability: 'ready' }]);
  });
});
