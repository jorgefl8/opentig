import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

export async function verifyReleaseMetadata(directory, version) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const metadata = parse(await readFile(path.join(directory, 'latest.yml'), 'utf8'));
  assert.equal(metadata.version, version, 'Update metadata version mismatch');
  assert.equal(metadata.files?.length, 1, 'Expected exactly one Windows x64 installer');
  const file = metadata.files[0];
  const name = `OpenTig-${version}-win32-x64-Setup.exe`;
  assert.equal(file.url, name, 'Update URL must name the local release installer');
  assert.equal(metadata.path, name);
  const installer = path.join(directory, name);
  const bytes = await readFile(installer);
  assert.equal(bytes.length, file.size);
  const digest = createHash('sha512').update(bytes).digest('base64');
  assert.equal(file.sha512, digest, 'Installer checksum mismatch');
  assert.equal(metadata.sha512, digest);
  assert.ok((await stat(`${installer}.blockmap`)).size > 0, 'Missing installer blockmap');
  return installer;
}
