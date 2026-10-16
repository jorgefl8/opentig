import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackDownload, windowsInstaller } from '../src/lib/downloads.ts';
import { notesWithScan, scanNotesStart, scanNotesEnd } from '../src/lib/installer-scan-notes.ts';

const stable = {
  id: 123, tag_name: 'v1.2.3', draft: false, prerelease: false,
  assets: [{ id: 456, size: 120000000, digest: `sha256:${'a'.repeat(64)}`, name: 'OpenTig-1.2.3-win32-x64-Setup.exe', state: 'uploaded', browser_download_url: 'https://github.com/jorgefl8/opentig/releases/download/v1.2.3/OpenTig-1.2.3-win32-x64-Setup.exe' }],
};

const scan = { schemaVersion: 1, installer: windowsInstaller(stable).identity,
  updatedAt: '2026-10-16T10:00:00.000Z', state: 'pending' };
const scannedRelease = { ...stable, body: notesWithScan('Release notes', scan, windowsInstaller(stable)) };

test('selects the uploaded Windows installer and keeps its version and URL together', () => {
  assert.deepEqual(windowsInstaller(stable), {
    version: 'v1.2.3', url: stable.assets[0].browser_download_url,
    identity: { repository: 'jorgefl8/opentig', version: 'v1.2.3', releaseId: 123, assetId: 456,
      name: stable.assets[0].name, size: 120000000, sha256: 'a'.repeat(64) },
  });
  for (const release of [null, {}, { ...stable, draft: true }, { ...stable, prerelease: true },
    { ...stable, tag_name: 'v1.2.3-beta.1' }, { ...stable, assets: [] },
    { ...stable, assets: [{ ...stable.assets[0], state: 'new' }] },
    { ...stable, assets: [{ ...stable.assets[0], browser_download_url: 'https://example.com/installer.exe' }] },
    { ...stable, assets: [{ ...stable.assets[0], name: 'OpenTig-1.2.3-win32-x64-Setup.exe.blockmap' }] },
    { ...stable, assets: [stable.assets[0], { ...stable.assets[0], id: 789 }] },
    { ...stable, assets: [null, false, 'installer', {}] }]) {
    assert.equal(windowsInstaller(release), undefined);
  }
});

test('keeps downloads usable without inventing an identity when GitHub metadata is missing or invalid', () => {
  const expected = { version: 'v1.2.3', url: stable.assets[0].browser_download_url };
  for (const id of [undefined, null, '123', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(windowsInstaller({ ...stable, id }), expected);
    assert.deepEqual(windowsInstaller({ ...stable, assets: [{ ...stable.assets[0], id }] }), expected);
    assert.deepEqual(windowsInstaller({ ...stable, assets: [{ ...stable.assets[0], size: id }] }), expected);
  }
  for (const digest of [undefined, null, '', 'a'.repeat(64), `sha1:${'a'.repeat(40)}`,
    `sha256:${'a'.repeat(63)}`, `sha256:${'g'.repeat(64)}`, `sha256:${'A'.repeat(64)}`]) {
    assert.deepEqual(windowsInstaller({ ...stable, assets: [{ ...stable.assets[0], digest }] }), expected);
  }
  assert.equal(fallbackDownload.identity, undefined);
});

test('resolves the installer and its scan from one release snapshot without mixing identities', () => {
  assert.deepEqual(windowsInstaller(scannedRelease), { ...windowsInstaller(stable), scan });
  for (const body of [null, 123, '<script>throw new Error("never executed")</script>',
    `${scanNotesStart}\ninvalid JSON\n${scanNotesEnd}`,
    `${scanNotesStart}\n${JSON.stringify({ ...scan, installer: { ...scan.installer, assetId: 789 } })}\n${scanNotesEnd}`]) {
    assert.deepEqual(windowsInstaller({ ...stable, body }), windowsInstaller(stable));
  }
  const replaced = { ...scannedRelease, assets: [{ ...stable.assets[0], id: 789 }] };
  assert.equal(windowsInstaller(replaced).scan, undefined);
  assert.equal(windowsInstaller({ ...scannedRelease, id: undefined }).scan, undefined);
});

test('shares one latest-release request and falls back on missing assets, limits and network failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const cases = [
      { response: { ok: true, json: async () => stable }, expected: windowsInstaller(stable) },
      { response: { ok: true, json: async () => scannedRelease }, expected: windowsInstaller(scannedRelease) },
      { response: { ok: true, json: async () => ({ ...stable, assets: [] }) }, expected: fallbackDownload },
      { response: { ok: false, status: 403 }, expected: fallbackDownload },
      { response: { ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }, expected: fallbackDownload },
      { error: new Error('offline'), expected: fallbackDownload },
    ];
    for (const [index, scenario] of cases.entries()) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; if (scenario.error) throw scenario.error; return scenario.response; };
      const { latestDownload } = await import(`../src/lib/downloads.ts?case=${index}`);
      const [first, second] = await Promise.all([latestDownload(), latestDownload()]);
      assert.deepEqual(first, scenario.expected);
      assert.deepEqual(second, first);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});
