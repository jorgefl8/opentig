import assert from 'node:assert/strict';
import test from 'node:test';
import { installationEvent, trackEvent } from '../src/lib/analytics.ts';

test('counts release navigation and guide entry, not unrelated links or guide section changes', () => {
  const home = 'https://opentig.com/';
  assert.equal(installationEvent('https://github.com/jorgefl8/opentig/releases/latest', home), 'open_downloads');
  assert.equal(installationEvent('https://github.com/jorgefl8/opentig/releases/download/v0.2.3/OpenTig-0.2.3-win32-x64-Setup.exe', home), 'download_installer');
  assert.equal(installationEvent('https://github.com/jorgefl8/opentig/releases/download/v0.2.3/OpenTig-0.2.3-win32-x64-Setup.exe.blockmap', home), undefined);
  assert.equal(installationEvent('/docs/getting-started/#run-the-headless-cli', home), 'open_installation_guide');
  assert.equal(installationEvent('#run-the-headless-cli', `${home}docs/getting-started/`), undefined);
  for (const href of ['#install', '/demo/', '/docs/features/', 'https://example.com/docs/getting-started/', 'https://github.com/other/project/releases/latest']) {
    assert.equal(installationEvent(href, home), undefined);
  }
});

test('sends fixed intent data and contains synchronous and asynchronous tracker failures', async () => {
  const calls = [];
  trackEvent('copy_cli_command', { placement: 'install' }, { track: (...args) => calls.push(args) });
  assert.deepEqual(calls, [['copy_cli_command', { placement: 'install' }]]);
  assert.doesNotThrow(() => trackEvent('open_downloads', { placement: 'hero' }, { track() { throw new Error('blocked'); } }));
  trackEvent('open_downloads', { placement: 'hero' }, { track: () => Promise.reject(new Error('offline')) });
  await new Promise(resolve => setImmediate(resolve));
});
