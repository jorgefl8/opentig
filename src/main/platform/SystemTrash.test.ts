import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemTrash } from './SystemTrash';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('SystemTrash', () => {
  it('passes one absolute literal path with globbing disabled', async () => {
    const root = await temporaryDirectory();
    const target = path.join(root, 'literal-[item].txt');
    await writeFile(target, 'keep');
    const operation = vi.fn(async (input: string | readonly string[]) => {
      await rm(Array.isArray(input) ? input[0]! : input);
    });

    await new SystemTrash(operation, process.platform).trashItem(target);

    expect(operation).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith([target], { glob: false });
  });

  it('rejects relative paths without invoking the dependency', async () => {
    const operation = vi.fn(async () => undefined);
    await expect(new SystemTrash(operation, process.platform).trashItem('relative.txt'))
      .rejects.toThrow('System Trash requires an absolute path.');
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects unsupported platforms without invoking the dependency', async () => {
    const operation = vi.fn(async () => undefined);
    const target = path.resolve('fixture.txt');
    await expect(new SystemTrash(operation, 'freebsd').trashItem(target))
      .rejects.toThrow('System Trash is not supported on this platform.');
    expect(operation).not.toHaveBeenCalled();
  });

  it('leaves the source intact and reports dependency failure', async () => {
    const root = await temporaryDirectory();
    const target = path.join(root, 'preserved.txt');
    await writeFile(target, 'preserved');
    const operation = vi.fn(async () => { throw new Error('trash unavailable'); });

    await expect(new SystemTrash(operation, process.platform).trashItem(target))
      .rejects.toThrow('Could not move the item to system Trash.');
    await expect(readFile(target, 'utf8')).resolves.toBe('preserved');
  });

  it('rejects a false success that leaves the source in place', async () => {
    const root = await temporaryDirectory();
    const target = path.join(root, 'still-here.txt');
    await writeFile(target, 'preserved');

    await expect(new SystemTrash(async () => undefined, process.platform).trashItem(target))
      .rejects.toThrow('System Trash did not remove the source item.');
    await expect(readFile(target, 'utf8')).resolves.toBe('preserved');
  });

  it('loads an explicitly packaged module path', async () => {
    const root = await temporaryDirectory();
    const target = path.join(root, 'packaged.txt');
    const modulePath = path.join(root, 'trash-fixture.mjs');
    await writeFile(target, 'fixture');
    await writeFile(modulePath, `
      import { rm } from 'node:fs/promises';
      export default async function trash(input, options) {
        if (options?.glob !== false) throw new Error('globbing enabled');
        await rm(input[0]);
      }
    `);

    await new SystemTrash(undefined, process.platform, modulePath).trashItem(target);

    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-system-trash-'));
  directories.push(directory);
  return directory;
}
