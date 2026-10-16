import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackDownload, windowsInstaller } from '../src/lib/downloads.ts';
import { installerScan } from '../src/lib/installer-scan.ts';
import { notesWithScan, scanFromNotes, scanNotesStart, scanNotesEnd } from '../src/lib/installer-scan-notes.ts';

const asset = {
  id: 456, size: 120000000, digest: `sha256:${'a'.repeat(64)}`, state: 'uploaded',
  name: 'OpenTig-1.2.3-win32-x64-Setup.exe',
  browser_download_url: 'https://github.com/jorgefl8/opentig/releases/download/v1.2.3/OpenTig-1.2.3-win32-x64-Setup.exe',
};
const release = { id: 123, tag_name: 'v1.2.3', draft: false, prerelease: false, assets: [asset] };
const download = windowsInstaller(release);
const updatedAt = '2026-10-16T10:00:00.000Z';
const analysisAt = '2026-10-16T09:59:00.000Z';
const report = { url: `https://www.virustotal.com/gui/file/${'a'.repeat(64)}`, verifiedAt: updatedAt };
const statistics = { malicious: 0, suspicious: 0, harmless: 2, undetected: 60,
  timeout: 1, 'confirmed-timeout': 1, failure: 1, 'type-unsupported': 3 };

function manifest(state = 'completed') {
  return { schemaVersion: 1, installer: { ...download.identity }, updatedAt, state,
    ...(state === 'completed' ? { report: { ...report }, analysis: { analysisAt, statistics: { ...statistics } } } : {}) };
}

test('accepts only the exact release asset, including its size and SHA-256', () => {
  const completed = manifest();
  assert.deepEqual(installerScan(completed, download), completed);
  for (const [key, value] of Object.entries({ repository: 'other/opentig', version: 'v1.2.2', releaseId: 124,
    assetId: 457, name: 'OpenTig-1.2.2-win32-x64-Setup.exe', size: asset.size + 1, sha256: 'b'.repeat(64) })) {
    assert.equal(installerScan({ ...completed, installer: { ...completed.installer, [key]: value } }, download), undefined, key);
  }
  for (const key of Object.keys(completed.installer)) {
    const missing = structuredClone(completed);
    delete missing.installer[key];
    assert.equal(installerScan(missing, download), undefined, key);
  }
});

test('rejects old results when an asset with the same filename is replaced or metadata is unavailable', () => {
  const completed = manifest();
  const replaced = windowsInstaller({ ...release, assets: [{ ...asset, id: 789, digest: `sha256:${'b'.repeat(64)}` }] });
  assert.equal(installerScan(completed, replaced), undefined);
  assert.equal(installerScan(completed, fallbackDownload), undefined);
  assert.equal(installerScan(completed, windowsInstaller({ ...release, id: undefined })), undefined);
  assert.equal(installerScan(completed, { ...download, version: 'v1.2.4' }), undefined);
  assert.equal(installerScan(completed, { ...download, url: 'https://example.com/installer.exe' }), undefined);
  assert.equal(installerScan(completed, { ...download, url: `${download.url}?other=asset` }), undefined);
});

test('out-of-order responses cannot attach an older release result to the current download', async () => {
  const older = manifest();
  const current = windowsInstaller({ ...release, id: 124, tag_name: 'v1.2.4', assets: [{ ...asset, id: 457,
    name: 'OpenTig-1.2.4-win32-x64-Setup.exe', digest: `sha256:${'b'.repeat(64)}`,
    browser_download_url: 'https://github.com/jorgefl8/opentig/releases/download/v1.2.4/OpenTig-1.2.4-win32-x64-Setup.exe' }] });
  const currentScan = { ...manifest('pending'), installer: current.identity };
  let resolveOld;
  const delayed = new Promise(resolve => { resolveOld = resolve; });
  assert.deepEqual(installerScan(await Promise.resolve(currentScan), current), currentScan);
  resolveOld(older);
  assert.equal(installerScan(await delayed, current), undefined);
});

test('pending, unavailable and active analyses never become completed results', () => {
  for (const state of ['pending', 'unavailable', 'queued', 'in-progress']) {
    const value = manifest(state);
    assert.deepEqual(installerScan(value, download), value);
    assert.equal(installerScan({ ...value, analysis: manifest().analysis }, download), undefined);
    if (state === 'queued' || state === 'in-progress') {
      assert.deepEqual(installerScan({ ...value, report }, download), { ...value, report });
    } else {
      assert.equal(installerScan({ ...value, report }, download), undefined);
    }
  }
  // Completion and report availability are separate facts.
  const withoutReport = manifest();
  delete withoutReport.report;
  assert.deepEqual(installerScan(withoutReport, download), withoutReport);
});

test('preserves malicious, suspicious and unassessed engines without deriving a safety verdict', () => {
  for (const counts of [statistics, { ...statistics, malicious: 2, suspicious: 1 },
    { ...statistics, harmless: 0, undetected: 0 }]) {
    const value = { ...manifest(), analysis: { analysisAt, statistics: counts } };
    assert.deepEqual(installerScan(value, download), value);
  }
});

test('rejects missing, partial, unknown and invalid result counts instead of treating them as zero', () => {
  for (const key of Object.keys(statistics)) {
    const missing = manifest();
    delete missing.analysis.statistics[key];
    assert.equal(installerScan(missing, download), undefined, key);
    for (const count of [null, '0', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = manifest();
      invalid.analysis.statistics[key] = count;
      assert.equal(installerScan(invalid, download), undefined, `${key}: ${count}`);
    }
  }
  for (const counts of [null, [], {}, { ...statistics, newCategory: 1 },
    Object.fromEntries(Object.keys(statistics).map(key => [key, 0])),
    { ...statistics, malicious: Number.MAX_SAFE_INTEGER }]) {
    assert.equal(installerScan({ ...manifest(), analysis: { analysisAt, statistics: counts } }, download), undefined);
  }
  for (const analysis of [undefined, null, {}, { analysisAt }, { statistics }]) {
    assert.equal(installerScan({ ...manifest(), analysis }, download), undefined);
  }
});

test('links only to the matching public file report with recorded availability verification', () => {
  for (const url of [`https://www.virustotal.com/gui/file/${'b'.repeat(64)}`,
    'https://www.virustotal.com/gui/analysis/not-a-file-hash', 'https://example.com/report',
    report.url.replace('https:', 'http:'), `${report.url}?redirect=other`, `${report.url}#other`]) {
    assert.equal(installerScan({ ...manifest(), report: { ...report, url } }, download), undefined);
  }
  for (const invalid of [null, {}, { url: report.url }, { ...report, verifiedAt: '2026-10-16T10:01:00.000Z' }]) {
    assert.equal(installerScan({ ...manifest(), report: invalid }, download), undefined);
  }
});

test('rejects malformed manifests, unknown schema/state, unexpected fields and incoherent timestamps', () => {
  for (const value of [null, undefined, false, [], '{}', {}, { ...manifest(), schemaVersion: 2 },
    { ...manifest(), schemaVersion: '1' }, { ...manifest(), state: 'safe' }, { ...manifest(), state: 'failed' },
    { ...manifest(), installer: null }, { ...manifest(), apiKey: 'must-not-be-forwarded' },
    { ...manifest(), report: { ...report, uploadUrl: 'must-not-be-forwarded' } },
    { ...manifest(), installer: { ...download.identity, unexpected: true } },
    { ...manifest(), analysis: { ...manifest().analysis, safe: true } }]) {
    assert.equal(installerScan(value, download), undefined);
  }
  for (const invalid of [null, 123, '', 'yesterday', '2026-02-30T10:00:00.000Z', '2026-10-16',
    '2026-10-16T10:00:00+00:00']) {
    assert.equal(installerScan({ ...manifest(), updatedAt: invalid }, download), undefined);
    assert.equal(installerScan({ ...manifest(), analysis: { analysisAt: invalid, statistics } }, download), undefined);
    assert.equal(installerScan({ ...manifest(), report: { ...report, verifiedAt: invalid } }, download), undefined);
  }
  assert.equal(installerScan({ ...manifest(), analysis: { analysisAt: '2026-10-16T10:01:00.000Z', statistics } }, download), undefined);
});

test('returns an independent validated snapshot so later input mutation cannot change a result', () => {
  const value = manifest();
  const expected = structuredClone(value);
  const validated = installerScan(value, download);
  value.installer.assetId = 789;
  value.analysis.statistics.malicious = 99;
  value.report.url = 'https://example.com';
  assert.deepEqual(validated, expected);
});

test('retains a resumable receipt while rejecting credentials, ambiguous phases and incoherent dates', () => {
  const startedAt = '2026-10-16T09:58:00.000Z';
  const submittedAt = '2026-10-16T09:58:01.000Z';
  const submission = { phase: 'submitted', startedAt, submittedAt, analysisId: 'analysis/opaque+id==' };
  for (const state of ['queued', 'in-progress', 'completed', 'unavailable']) {
    const value = { ...manifest(state), submission };
    assert.deepEqual(installerScan(value, download), value);
  }
  for (const [state, phase] of [['pending', 'uploading'], ['unavailable', 'uploading'], ['unavailable', 'uncertain']]) {
    const value = { ...manifest(state), submission: { phase, startedAt } };
    assert.deepEqual(installerScan(value, download), value);
  }
  for (const invalid of [null, {}, { ...submission, phase: 'unknown' }, { ...submission, apiKey: 'private' },
    { ...submission, uploadUrl: 'private' }, { ...submission, analysisId: 'bad?id=other' },
    { ...submission, submittedAt: '2026-10-16T09:57:00.000Z' }, { ...submission, startedAt: '2026-10-16T10:01:00.000Z' },
    { phase: 'uncertain', startedAt, analysisId: 'should-not-exist' }]) {
    assert.equal(installerScan({ ...manifest(), submission: invalid }, download), undefined);
  }
  assert.equal(installerScan({ ...manifest('pending'), submission }, download), undefined);
  assert.equal(installerScan({ ...manifest('queued'), submission: { phase: 'uploading', startedAt } }, download), undefined);
  assert.equal(installerScan({ ...manifest('pending'), submission: { phase: 'uncertain', startedAt } }, download), undefined);
});

test('appends scan metadata without changing existing notes or their changelog markers', () => {
  const body = 'Owner introduction 🐯\r\n<!-- opentig:release-notes:start -->\r\n## Changes\r\nKeep all of this.\r\n<!-- opentig:release-notes:end -->\r\n';
  const result = notesWithScan(body, manifest(), download);
  assert.ok(result.startsWith(body));
  assert.deepEqual(scanFromNotes(result, download), manifest());
  assert.equal(notesWithScan(result, manifest(), download), result);
  assert.deepEqual(scanFromNotes(notesWithScan('', manifest('pending'), download), download), manifest('pending'));
});

test('updates only its own comment and preserves all surrounding release text exactly', () => {
  const pending = notesWithScan('', manifest('pending'), download);
  const before = '## Release notes\n\n<!-- another:comment -->\n';
  const after = '\r\n## Manual instructions\r\nKeep these unchanged.\n';
  const complete = { ...manifest(), updatedAt: '2026-10-16T10:01:00.000Z' };
  const result = notesWithScan(before + pending + after, complete, download);
  assert.equal(result, before + notesWithScan('', complete, download) + after);
  assert.deepEqual(scanFromNotes(result, download), complete);
});

test('rejects ambiguous or corrupted scan blocks instead of damaging release notes', () => {
  const valid = notesWithScan('', manifest(), download);
  for (const body of [scanNotesStart, scanNotesEnd, `${scanNotesEnd}\n${scanNotesStart}`,
    valid + valid, `${scanNotesStart}\n{}\n${scanNotesStart}\n${scanNotesEnd}`,
    `${scanNotesStart}\ninvalid json\n${scanNotesEnd}`,
    `${scanNotesStart}\n${JSON.stringify(manifest())}<!-- nested -->\n${scanNotesEnd}`,
    `${scanNotesStart}\n${' '.repeat(16385)}\n${scanNotesEnd}`]) {
    assert.equal(scanFromNotes(body, download), undefined);
    assert.throws(() => notesWithScan(body, manifest(), download));
  }
  for (const body of [undefined, null, false, '', 'Ordinary release notes']) {
    assert.equal(scanFromNotes(body, download), undefined);
  }
});

test('refuses stale updates, conflicting timestamps, mismatched assets and invalid public fields', () => {
  const existing = notesWithScan('Keep this', manifest(), download);
  assert.throws(() => notesWithScan(existing, { ...manifest('pending'), updatedAt: analysisAt }, download), /newer/);
  assert.throws(() => notesWithScan(existing, manifest('pending'), download), /conflicting/);
  const wrongAsset = { ...manifest(), installer: { ...download.identity, assetId: 789 } };
  assert.throws(() => notesWithScan('Keep this', wrongAsset, download), /does not match/);
  const wrongBlock = `${scanNotesStart}\n${JSON.stringify(wrongAsset)}\n${scanNotesEnd}`;
  assert.throws(() => notesWithScan(wrongBlock, manifest(), download), /another asset/);
  assert.throws(() => notesWithScan('Keep this', { ...manifest(), apiKey: 'not-public' }, download));
  assert.throws(() => notesWithScan('', manifest(), fallbackDownload));
  assert.throws(() => notesWithScan('🐯'.repeat(30000), manifest(), download), /size/);
});
