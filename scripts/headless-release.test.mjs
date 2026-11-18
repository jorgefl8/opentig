import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { assertRelease, publicationTag, validateIdentity, verifyBundle } from './headless-release.mjs';

const commit = 'a'.repeat(40);
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'opentig-cli-artifact-'));
  roots.push(root);
  mkdirSync(path.join(root, 'package'));
  writeFileSync(path.join(root, 'package/package.json'), JSON.stringify({ name: '@opentig/cli', version: '0.1.2', bin: { opentig: 'dist/bin.mjs' }, ...overrides }));
  const filename = 'opentig-cli-0.1.2.tgz';
  execFileSync('tar', ['-czf', path.join(root, filename), '-C', root, 'package/package.json']);
  const bytes = readFileSync(path.join(root, filename));
  const metadata = { schemaVersion: 1, packageName: '@opentig/cli', version: '0.1.2', filename,
    sha256: createHash('sha256').update(bytes).digest('hex'), npmIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    release: { tag: 'v0.1.2', commit } };
  const save = () => writeFileSync(path.join(root, 'opentig-headless.json'), JSON.stringify(metadata));
  save();
  return { root, metadata, save };
}

it('accepts the exact packed release identity and both digests', () => {
  const { root } = fixture();
  expect(verifyBundle(root, 'v0.1.2', commit).metadata.version).toBe('0.1.2');
});
it('rejects different code, version, unsafe filename, or tampered bytes', () => {
  const { root, metadata, save } = fixture();
  expect(() => verifyBundle(root, 'v0.1.2', 'b'.repeat(40))).toThrow(/identity/);
  expect(() => verifyBundle(root, 'v0.1.3', commit)).toThrow(/identity/);
  metadata.filename = '../elsewhere.tgz'; save();
  expect(() => verifyBundle(root, 'v0.1.2', commit)).toThrow(/identity/);
  metadata.filename = 'opentig-cli-0.1.2.tgz'; save();
  writeFileSync(path.join(root, metadata.filename), 'tampered');
  expect(() => verifyBundle(root, 'v0.1.2', commit)).toThrow(/integrity/);
});
it('checks npm integrity independently of the SHA-256 digest', () => {
  const { root, metadata, save } = fixture();
  metadata.npmIntegrity = 'sha512-wrong'; save();
  expect(() => verifyBundle(root, 'v0.1.2', commit)).toThrow(/integrity/);
});
it('checks the packed package identity and refuses publish lifecycle hooks', () => {
  expect(() => verifyBundle(fixture({ version: '0.1.1' }).root, 'v0.1.2', commit)).toThrow(/identity/);
  expect(() => verifyBundle(fixture({ scripts: { prepublishOnly: 'unsafe' } }).root, 'v0.1.2', commit)).toThrow(/lifecycle/);
});
it('attaches only to the matching draft and publishes only stable published releases', () => {
  const draft = { tagName: 'v0.1.2', targetCommitish: commit, isDraft: true, isPrerelease: false };
  expect(() => assertRelease(draft, 'v0.1.2', commit, true)).not.toThrow();
  expect(() => assertRelease(draft, 'v0.1.2', commit, false)).toThrow();
  const published = { ...draft, isDraft: false };
  expect(() => assertRelease(published, 'v0.1.2', commit, false)).not.toThrow();
  expect(() => assertRelease(published, 'v0.1.2', commit, true)).toThrow();
  expect(() => assertRelease({ ...published, isPrerelease: true }, 'v0.1.2', commit, false)).toThrow();
  expect(() => assertRelease(published, 'v0.1.2', 'b'.repeat(40), false)).toThrow();
});
it('requires stable tags and complete commit identities', () => {
  for (const tag of ['main', 'v0.1.2-beta.1', '--help', 'v0.1.2/../../']) expect(() => validateIdentity(tag, commit)).toThrow();
  expect(() => validateIdentity('v0.1.2', 'abc123')).toThrow();
});
it('does not move npm latest backwards when backfilling an older release', () => {
  expect(publicationTag('0.1.2', '0.1.3')).toBe('release-0.1.2');
  expect(publicationTag('0.1.10', '0.1.9')).toBe('latest');
  expect(publicationTag('0.1.2', '0.0.0-reserved.0')).toBe('latest');
  expect(publicationTag('0.1.2', undefined)).toBe('latest');
});
