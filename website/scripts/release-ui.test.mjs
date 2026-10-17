import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { fallbackDownload, windowsInstaller } from '../src/lib/downloads.ts';
import { notesWithScan } from '../src/lib/installer-scan-notes.ts';
import { updateRelease } from '../src/lib/release-ui.ts';

const identity = {
  repository: 'jorgefl8/opentig', version: 'v1.2.3', releaseId: 123, assetId: 456,
  name: 'OpenTig-1.2.3-win32-x64-Setup.exe', size: 120000000, sha256: 'a'.repeat(64),
};
const download = { version: identity.version, identity,
  url: `https://github.com/jorgefl8/opentig/releases/download/${identity.version}/${identity.name}` };
const statistics = { malicious: 0, suspicious: 0, harmless: 2, undetected: 60,
  timeout: 1, 'confirmed-timeout': 1, failure: 1, 'type-unsupported': 3 };
const updatedAt = '2026-10-16T10:00:00.000Z';
const analysisAt = '2026-10-16T09:59:00.000Z';
const report = { url: `https://www.virustotal.com/gui/file/${identity.sha256}`, verifiedAt: updatedAt };
function scan(state = 'completed') {
  return { schemaVersion: 1, installer: { ...identity }, state, updatedAt,
    ...(state === 'completed' ? { analysis: { analysisAt, statistics: { ...statistics } }, report } : {}) };
}
function page(t) {
  const markup = `<a data-windows-download href="${fallbackDownload.url}">Download</a>
    <span data-release-version>${fallbackDownload.version}</span>
    <div data-installer-scan><button type="button">VirusTotal: <span data-scan-status role="status">Scan status unavailable</span></button>
    <div popover><div data-scan-details></div><p>An antivirus scan is not a guarantee of safety.</p></div></div>`;
  const dom = new JSDOM(markup.repeat(2));
  t.after(() => dom.window.close());
  return dom.window.document;
}

test('renders exact release metadata and counts in both download locations from a real parsed snapshot', t => {
  const document = page(t);
  const release = windowsInstaller({ id: identity.releaseId, tag_name: identity.version, draft: false, prerelease: false,
    body: notesWithScan('Release notes', scan(), download),
    assets: [{ id: identity.assetId, name: identity.name, size: identity.size, digest: `sha256:${identity.sha256}`,
      state: 'uploaded', browser_download_url: download.url }] });
  updateRelease(document, release);
  for (const host of document.querySelectorAll('[data-installer-scan]')) {
    assert.equal(host.dataset.state, 'completed');
    assert.equal(host.querySelector('[data-scan-status]').textContent, '0 malicious · 0 suspicious');
    assert.match(host.textContent, /62 engines assessed the file; 6 did not assess it/);
    assert.match(host.textContent, /not a guarantee of safety/);
    assert.equal(host.querySelector('code').textContent, identity.sha256);
    assert.equal(host.querySelector('time').dateTime, analysisAt);
    assert.match(host.textContent, /2026-10-16 09:59 UTC/);
    assert.deepEqual([...host.querySelectorAll('dd')].map(e => e.textContent), ['0', '0', '2', '60', '1', '1', '1', '3']);
    const link = host.querySelector('a');
    assert.equal(link.href, report.url);
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.ok(link.getAttribute('aria-label').includes(identity.name));
  }
  assert.ok([...document.querySelectorAll('[data-windows-download]')].every(a => a.href === download.url));
  assert.ok([...document.querySelectorAll('[data-release-version]')].every(e => e.textContent === identity.version));
});

test('shows pending, queued, active and unavailable states without inventing engine results or report links', t => {
  const document = page(t);
  for (const [state, text] of Object.entries({ pending: 'Scan pending', queued: 'Scan queued',
    'in-progress': 'Scan in progress', unavailable: 'Scan status unavailable' })) {
    updateRelease(document, { ...download, scan: scan(state) });
    assert.equal(document.querySelector('[data-scan-status]').textContent, text);
    assert.equal(document.querySelectorAll('[data-scan-details] a, [data-scan-details] dl').length, 0);
    assert.doesNotMatch(document.querySelector('[data-installer-scan]').textContent, /0 malicious/);
  }
  updateRelease(document, { ...download, scan: { ...scan('in-progress'), report } });
  assert.equal(document.querySelector('[data-scan-details] a').href, report.url);
  assert.equal(document.querySelectorAll('dd').length, 0);
});

test('distinguishes malicious, suspicious and wholly unassessed results without a clean verdict', t => {
  const document = page(t);
  for (const [malicious, suspicious] of [[3, 0], [0, 2], [3, 2]]) {
    const value = scan();
    value.analysis.statistics = { ...statistics, malicious, suspicious };
    updateRelease(document, { ...download, scan: value });
    assert.equal(document.querySelector('[data-installer-scan]').dataset.state, 'flagged');
    assert.equal(document.querySelector('[data-scan-status]').textContent, `${malicious} malicious · ${suspicious} suspicious`);
  }
  const value = scan();
  value.analysis.statistics = { ...statistics, harmless: 0, undetected: 0 };
  updateRelease(document, { ...download, scan: value });
  assert.equal(document.querySelector('[data-scan-status]').textContent, 'No engines assessed the file');
  assert.match(document.body.textContent, /0 engines assessed the file; 6 did not assess it/);
});

test('retains completed counts without a public report and removes a previous link', t => {
  const document = page(t);
  updateRelease(document, { ...download, scan: scan() });
  const value = scan();
  delete value.report;
  updateRelease(document, { ...download, scan: value });
  assert.equal(document.querySelector('[data-scan-status]').textContent, '0 malicious · 0 suspicious');
  assert.equal(document.querySelectorAll('[data-scan-details] a').length, 0);
  assert.match(document.body.textContent, /Public report link not available yet/);
});

test('clears stale results, hashes, dates and links when a new version or fallback replaces a scanned release', t => {
  const document = page(t);
  const nextIdentity = { ...identity, version: 'v1.2.4', name: 'OpenTig-1.2.4-win32-x64-Setup.exe', assetId: 457, sha256: 'b'.repeat(64) };
  for (const next of [fallbackDownload, { ...download, scan: undefined },
    { version: nextIdentity.version, identity: nextIdentity,
      url: `https://github.com/jorgefl8/opentig/releases/download/${nextIdentity.version}/${nextIdentity.name}`, scan: scan() }]) {
    updateRelease(document, { ...download, scan: scan() });
    updateRelease(document, next);
    assert.equal(document.querySelector('[data-scan-status]').textContent, 'Scan status unavailable');
    assert.equal(document.querySelectorAll('[data-scan-details] a, [data-scan-details] time, dd').length, 0);
    assert.ok([...document.querySelectorAll('[data-windows-download]')].every(a => a.href === next.url));
    assert.ok([...document.querySelectorAll('[data-release-version]')].every(e => e.textContent === next.version));
    if (!next.identity) assert.equal(document.querySelectorAll('[data-scan-details] code').length, 0);
    else assert.equal(document.querySelector('code').textContent, next.identity.sha256);
  }
});

test('rejects corrupt counters and unsafe or mismatched public reports at the UI boundary', t => {
  const document = page(t);
  for (const change of [v => { delete v.analysis.statistics.failure; },
    v => { v.installer.assetId++; }, v => { v.report = { ...report, url: 'javascript:alert(1)' }; },
    v => { v.report = { ...report, url: `https://www.virustotal.com/gui/file/${'b'.repeat(64)}` }; }]) {
    const value = scan();
    change(value);
    updateRelease(document, { ...download, scan: value });
    assert.equal(document.querySelector('[data-scan-status]').textContent, 'Scan status unavailable');
    assert.equal(document.querySelectorAll('[data-scan-details] a, dd').length, 0);
  }
});
