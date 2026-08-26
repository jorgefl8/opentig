import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPOSITORY_FAVICON_MAX_BYTES } from '../../shared/repository-favicon';
import { readRepositoryFavicon } from './RepositoryFavicon';

const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-favicon-'));
  directories.push(directory);
  return directory;
}

describe('readRepositoryFavicon', () => {
  it('prefers a well-known favicon.svg at the repository root', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await mkdir(path.join(root, 'public'));
    await writeFile(path.join(root, 'public', 'favicon.ico'), Buffer.from([0, 0, 1, 0]));

    const favicon = await readRepositoryFavicon(root);
    expect(favicon?.mimeType).toBe('image/svg+xml');
    expect(favicon?.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('resolves an HTML icon href under public/', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'index.html'), '<link rel="icon" href="/brand/logo.png">');
    await mkdir(path.join(root, 'public', 'brand'), { recursive: true });
    await writeFile(path.join(root, 'public', 'brand', 'logo.png'), pngBytes());

    const favicon = await readRepositoryFavicon(root);
    expect(favicon?.mimeType).toBe('image/png');
  });

  it('ignores icon hrefs that escape the repository root', async () => {
    const parent = await tempDir();
    const root = path.join(parent, 'app');
    await mkdir(root);
    await writeFile(path.join(parent, 'secret.svg'), '<svg/>');
    await writeFile(path.join(root, 'index.html'), '<link rel="icon" href="../secret.svg">');

    await expect(readRepositoryFavicon(root)).resolves.toBeNull();
  });

  it('skips oversized files and returns null when nothing usable exists', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'favicon.png'), Buffer.alloc(REPOSITORY_FAVICON_MAX_BYTES + 1, 1));
    await expect(readRepositoryFavicon(root)).resolves.toBeNull();
  });
});

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}
