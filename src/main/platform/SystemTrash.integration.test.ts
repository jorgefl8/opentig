import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemTrash } from './SystemTrash';

const directories: string[] = [];
const integrationTest = process.env.OPENTIG_SYSTEM_TRASH_INTEGRATION === '1' ? it : it.skip;
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('SystemTrash integration', () => {
  integrationTest('moves a literal fixture to the platform Trash', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-trash-smoke-'));
    directories.push(directory);
    const target = path.join(directory, 'literal-[fixture].txt');
    const sibling = path.join(directory, 'literal-f.txt');
    await writeFile(target, 'fixture');
    await writeFile(sibling, 'preserve');

    await new SystemTrash().trashItem(target);

    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(sibling, 'utf8')).resolves.toBe('preserve');
  });

  integrationTest('moves a populated directory with spaces and braces without touching its sibling', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-trash-smoke-'));
    directories.push(directory);
    const target = path.join(directory, 'folder {one,two} with spaces');
    const sibling = path.join(directory, 'folder one with spaces');
    await mkdir(target);
    await mkdir(sibling);
    await writeFile(path.join(target, 'child.txt'), 'fixture');
    await writeFile(path.join(sibling, 'child.txt'), 'preserve');

    await new SystemTrash().trashItem(target);

    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(sibling, 'child.txt'), 'utf8')).resolves.toBe('preserve');
  });
});
