import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { GitProcess } from '../git/GitProcess';
import { RepositoryService } from '../git/RepositoryService';
import { SettingsStore } from '../persistence/SettingsStore';
import { FileService } from './FileService';
import { FileOperationHistory } from './FileOperationHistory';

const execFileAsync = promisify(execFile);
const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

describe('FileOperationHistory', () => {
  it('keeps empty state per repository and clears redo after a new mutation', async () => {
    const fixture = await createFixture();
    expect(fixture.history.state(fixture.repositoryId)).toEqual({ canUndo: false, undoLabel: null, canRedo: false, redoLabel: null });
    const created = await fixture.files.create(fixture.repositoryId, '', 'one.txt', 'file');
    if (created.status !== 'created') throw new Error('fixture conflict');
    fixture.history.recordCreate(fixture.repositoryId, 'Create file', [{ path: created.path, kind: created.kind }]);
    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('applied');
    expect(fixture.history.state(fixture.repositoryId).canRedo).toBe(true);
    await fixture.files.create(fixture.repositoryId, '', 'two.txt', 'file');
    fixture.history.recordCreate(fixture.repositoryId, 'Create file', [{ path: 'two.txt', kind: 'file' }]);
    expect(fixture.history.state(fixture.repositoryId).canRedo).toBe(false);
    expect(fixture.history.state('another-repository').canUndo).toBe(false);
  });

  it('undoes and redoes rename without overwriting conflicts', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.work, 'old.txt'), 'value');
    const result = await fixture.files.rename(fixture.repositoryId, 'old.txt', 'new.txt');
    if (result.status !== 'renamed') throw new Error('fixture conflict');
    fixture.history.recordMove(fixture.repositoryId, 'Rename item', [{ from: result.from, to: result.to }], 'rename');
    await writeFile(path.join(fixture.work, 'old.txt'), 'occupied');
    expect(await fixture.history.undo(fixture.repositoryId)).toMatchObject({ status: 'conflict' });
    expect(await readFile(path.join(fixture.work, 'new.txt'), 'utf8')).toBe('value');
    await rm(path.join(fixture.work, 'old.txt'));
    expect(await fixture.history.undo(fixture.repositoryId)).toMatchObject({ status: 'applied', pathChanges: [{ from: 'new.txt', to: 'old.txt' }] });
    expect(await fixture.history.redo(fixture.repositoryId)).toMatchObject({ status: 'applied' });
  });

  it('treats a multi-file move as one step', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'from')); await mkdir(path.join(fixture.work, 'to'));
    await writeFile(path.join(fixture.work, 'from', 'a.txt'), 'a'); await writeFile(path.join(fixture.work, 'from', 'b.txt'), 'b');
    const moved = await fixture.files.moveEntries(fixture.repositoryId, ['from/a.txt', 'from/b.txt'], 'to');
    fixture.history.recordMove(fixture.repositoryId, 'Move 2 items', moved.moved);
    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('applied');
    expect(await readFile(path.join(fixture.work, 'from', 'a.txt'), 'utf8')).toBe('a');
    expect(fixture.history.state(fixture.repositoryId).canUndo).toBe(false);
  });

  it('uses injected trash for create undo and recreates the exact path on redo', async () => {
    const fixture = await createFixture();
    await fixture.files.create(fixture.repositoryId, '', 'created.txt', 'file');
    fixture.history.recordCreate(fixture.repositoryId, 'Create file', [{ path: 'created.txt', kind: 'file' }]);
    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('applied');
    await expect(readFile(path.join(fixture.work, 'created.txt'))).rejects.toThrow();
    expect((await fixture.history.redo(fixture.repositoryId)).status).toBe('applied');
    expect(await readFile(path.join(fixture.work, 'created.txt'), 'utf8')).toBe('');
  });

  it('restores exact binary delete snapshots and validates content before redo', async () => {
    const fixture = await createFixture();
    const bytes = Buffer.from([0, 255, 1, 2, 128]);
    await writeFile(path.join(fixture.work, 'binary.bin'), bytes);
    const prepared = await fixture.history.prepareDelete(fixture.repositoryId, ['binary.bin']);
    await fixture.trash.trashItem(path.join(fixture.work, 'binary.bin'));
    expect(fixture.history.recordDelete(fixture.repositoryId, prepared, ['binary.bin'])).toBe('undo');
    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('applied');
    expect(await readFile(path.join(fixture.work, 'binary.bin'))).toEqual(bytes);
    await writeFile(path.join(fixture.work, 'binary.bin'), 'changed');
    expect((await fixture.history.redo(fixture.repositoryId)).status).toBe('conflict');
    expect(fixture.history.state(fixture.repositoryId).canRedo).toBe(true);
  });

  it('uses a system-Trash marker for folders and consumes it without redo', async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.work, 'folder'));
    const prepared = await fixture.history.prepareDelete(fixture.repositoryId, ['folder']);
    expect(prepared.recovery).toBe('system-trash');
    await fixture.trash.trashItem(path.join(fixture.work, 'folder'));
    fixture.history.recordDelete(fixture.repositoryId, prepared, ['folder']);
    expect(await fixture.history.undo(fixture.repositoryId)).toMatchObject({ status: 'system-trash', paths: ['folder'] });
    expect(fixture.history.state(fixture.repositoryId).canRedo).toBe(false);
  });

  it('serializes operations for one repository', async () => {
    const fixture = await createFixture();
    const order: number[] = [];
    const first = fixture.history.serialize(fixture.repositoryId, async () => { await new Promise((resolve) => setTimeout(resolve, 20)); order.push(1); });
    const second = fixture.history.serialize(fixture.repositoryId, async () => { order.push(2); });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it('undoes and redoes a content replacement without overwriting later edits', async () => {
    const fixture = await createFixture();
    const before = (await fixture.files.snapshot(fixture.repositoryId, 'tracked.txt', 1024))!;
    const after = { ...before, bytes: Buffer.from('replaced') };
    await fixture.files.replaceSnapshots(fixture.repositoryId, [before], [after]);
    fixture.history.recordEdit(fixture.repositoryId, 'Replace in file', [before], [after]);

    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('applied');
    expect(await readFile(path.join(fixture.work, 'tracked.txt'), 'utf8')).toBe('tracked');
    expect((await fixture.history.redo(fixture.repositoryId)).status).toBe('applied');
    expect(await readFile(path.join(fixture.work, 'tracked.txt'), 'utf8')).toBe('replaced');

    await writeFile(path.join(fixture.work, 'tracked.txt'), 'external');
    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('conflict');
    expect(await readFile(path.join(fixture.work, 'tracked.txt'), 'utf8')).toBe('external');
  });

  it('keeps at most fifty steps per repository', async () => {
    const fixture = await createFixture();
    for (let index = 0; index < 51; index += 1) {
      const file = `created-${index}.txt`;
      await fixture.files.create(fixture.repositoryId, '', file, 'file');
      fixture.history.recordCreate(fixture.repositoryId, `Create ${index}`, [{ path: file, kind: 'file' }]);
    }
    for (let index = 0; index < 50; index += 1) expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('applied');
    expect((await fixture.history.undo(fixture.repositoryId)).status).toBe('empty');
    expect(await readFile(path.join(fixture.work, 'created-0.txt'), 'utf8')).toBe('');
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-history-')); directories.push(root);
  const work = path.join(root, 'work'); const trashRoot = path.join(root, 'trash');
  await git(root, ['init', '-b', 'main', work]); await git(work, ['config', 'user.name', 'OpenTig Test']); await git(work, ['config', 'user.email', 'opentig@example.invalid']);
  await writeFile(path.join(work, 'tracked.txt'), 'tracked'); await git(work, ['add', '.']); await git(work, ['commit', '-m', 'Initial']); await mkdir(trashRoot);
  const settings = new SettingsStore(path.join(root, 'settings.json')); await settings.load();
  const process = new GitProcess(); const repositories = new RepositoryService(process, settings); const files = new FileService(process, repositories); const repository = await repositories.openPath(work);
  let counter = 0;
  const trash = { available: true, trashItem: async (target: string) => { await rename(target, path.join(trashRoot, `${++counter}-${path.basename(target)}`)); } };
  const history = new FileOperationHistory(files, trash);
  return { root, work, files, history, trash, repositoryId: repository.id };
}

async function git(cwd: string, args: string[]): Promise<void> { await execFileAsync('git', args, { cwd, windowsHide: true }); }
