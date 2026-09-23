import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { verifyReleaseMetadata } from './release-metadata.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
it('rejects stale metadata, substituted installers and remote/path-traversal artifact URLs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-release-'));
  roots.push(directory);
  const name = 'OpenTig-0.1.0-win32-x64-Setup.exe';
  const bytes = Buffer.from('fixture-installer');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const metadata = { version: '0.1.0', files: [{ url: name, size: bytes.length, sha512 }], path: name, sha512 };
  const save = (value) => writeFile(path.join(directory, 'latest.yml'), stringify(value));
  await writeFile(path.join(directory, name), bytes);
  await writeFile(path.join(directory, `${name}.blockmap`), 'fixture');
  await save(metadata);
  await expect(verifyReleaseMetadata(directory, '0.1.0')).resolves.toBe(path.join(directory, name));
  await expect(verifyReleaseMetadata(directory, '0.2.0')).rejects.toThrow('version mismatch');
  for (const url of ['../substituted.exe', 'https://example.com/installer.exe']) {
    await save({ ...metadata, files: [{ ...metadata.files[0], url }] });
    await expect(verifyReleaseMetadata(directory, '0.1.0')).rejects.toThrow('Update URL');
  }
  await save(metadata);
  await writeFile(path.join(directory, name), Buffer.alloc(bytes.length));
  await expect(verifyReleaseMetadata(directory, '0.1.0')).rejects.toThrow('checksum mismatch');
});
