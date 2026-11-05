import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDownload, latestReleaseUrl } from './release-download.mjs';
import { fallbackDownload, staticDownload } from '../src/lib/downloads.ts';

const name = 'OpenTig-1.2.3-win32-x64-Setup.exe';
const url = `https://github.com/jorgefl8/opentig/releases/download/v1.2.3/${name}`;
const release = {
  id: 1, tag_name: 'v1.2.3', draft: false, prerelease: false, body: 'Notes',
  assets: [{ id: 2, size: 3, digest: `sha256:${'a'.repeat(64)}`, name, state: 'uploaded', browser_download_url: url }],
};

test('renders the static installer outside production builds', () => {
  assert.deepEqual(fallbackDownload, staticDownload);
  assert.match(staticDownload.url, /\/releases\/download\/(v\d+\.\d+\.\d+)\/OpenTig-\d+\.\d+\.\d+-win32-x64-Setup\.exe$/);
  assert.ok(staticDownload.url.includes(`/${staticDownload.version}/OpenTig-${staticDownload.version.slice(1)}-`));
});

test('bakes only the version and URL of the latest release into the build', async () => {
  let requested;
  const fetcher = async (target, init) => { requested = [target, init.headers.Accept]; return { ok: true, json: async () => release }; };
  assert.deepEqual(await buildDownload({ fetcher }), { version: 'v1.2.3', url });
  assert.deepEqual(requested, [latestReleaseUrl, 'application/vnd.github+json']);
});

test('keeps the static installer and warns when GitHub cannot provide one', async () => {
  for (const fetcher of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({ ...release, assets: [] }) }),
  ]) {
    const warnings = [];
    assert.deepEqual(await buildDownload({ fetcher, warn: message => warnings.push(message) }), staticDownload);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], new RegExp(`static installer ${staticDownload.version}`));
  }
});

test('requires a valid release when the deployment supplies one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opentig-release-'));
  const valid = join(directory, 'valid.json');
  const invalid = join(directory, 'invalid.json');
  await writeFile(valid, JSON.stringify(release));
  await writeFile(invalid, JSON.stringify({ ...release, prerelease: true }));
  const fetcher = async () => { throw new Error('the release file must not fall back to the network'); };
  assert.deepEqual(await buildDownload({ releaseFile: valid, fetcher }), { version: 'v1.2.3', url });
  await assert.rejects(buildDownload({ releaseFile: invalid, fetcher }), /not a stable release/);
  await assert.rejects(buildDownload({ releaseFile: join(directory, 'missing.json'), fetcher }), /ENOENT/);
});
