import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackDownload, windowsInstaller } from '../src/lib/downloads.ts';

const stable = {
  tag_name: 'v1.2.3', draft: false, prerelease: false,
  assets: [{ name: 'OpenTig-1.2.3-win32-x64-Setup.exe', state: 'uploaded', browser_download_url: 'https://github.com/jorgefl8/opentig/releases/download/v1.2.3/OpenTig-1.2.3-win32-x64-Setup.exe' }],
};

test('selects the uploaded Windows installer and keeps its version and URL together', () => {
  assert.deepEqual(windowsInstaller(stable), { version: 'v1.2.3', url: stable.assets[0].browser_download_url });
  for (const release of [null, {}, { ...stable, draft: true }, { ...stable, prerelease: true },
    { ...stable, tag_name: 'v1.2.3-beta.1' }, { ...stable, assets: [] },
    { ...stable, assets: [{ ...stable.assets[0], state: 'new' }] },
    { ...stable, assets: [{ ...stable.assets[0], browser_download_url: 'https://example.com/installer.exe' }] },
    { ...stable, assets: [{ ...stable.assets[0], name: 'OpenTig-1.2.3-win32-x64-Setup.exe.blockmap' }] }]) {
    assert.equal(windowsInstaller(release), undefined);
  }
});

test('shares one latest-release request and falls back on missing assets, limits and network failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const cases = [
      { response: { ok: true, json: async () => stable }, expected: windowsInstaller(stable) },
      { response: { ok: true, json: async () => ({ ...stable, assets: [] }) }, expected: fallbackDownload },
      { response: { ok: false, status: 403 }, expected: fallbackDownload },
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
