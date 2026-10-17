import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { windowsInstaller } from '../website/src/lib/downloads.ts';
import { notesWithScan, scanFromNotes, scanNotesStart } from '../website/src/lib/installer-scan-notes.ts';
import { createVirusTotalClient, VirusTotalError } from './virustotal-client.mjs';
import { downloadReleaseInstaller, publicReportAvailable, releaseScanPlan, scanInvocation, scanPublishedRelease } from './scan-release.mjs';

const repository = 'jorgefl8/opentig';
const tag = 'v1.2.3';
const commit = 'a'.repeat(40);
const bytes = Buffer.from('Synthetic installer bytes for offline workflow tests.');
const digest = createHash('sha256').update(bytes).digest('hex');
const name = 'OpenTig-1.2.3-win32-x64-Setup.exe';
const intro = 'Maintainer introduction\r\n<!-- opentig:release-notes:start -->\r\n## Changes\r\nKeep this changelog.\r\n<!-- opentig:release-notes:end -->\r\nOwner instructions 🐯\r\n';
const original = { id: 123, tag_name: tag, draft: false, prerelease: false, published_at: '2026-10-16T10:00:00Z',
  html_url: `https://github.com/${repository}/releases/tag/${tag}`, body: intro,
  assets: [{ id: 456, name, size: bytes.length, digest: `sha256:${digest}`, state: 'uploaded',
    browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}` }] };
const download = windowsInstaller(original);
const statistics = { malicious: 0, suspicious: 1, harmless: 2, undetected: 60,
  timeout: 1, 'confirmed-timeout': 2, failure: 3, 'type-unsupported': 4 };
const startedAt = '2026-10-16T11:00:00.000Z';
const submission = { phase: 'submitted', startedAt, submittedAt: startedAt, analysisId: 'opaque-analysis-id' };
let directory;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'opentig-release-scan-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function scan(state = 'queued', checkpoint = submission) {
  return { schemaVersion: 1, installer: download.identity, updatedAt: '2026-10-16T11:01:00.000Z', state,
    ...(checkpoint ? { submission: checkpoint } : {}),
    ...(state === 'completed' ? { analysis: { analysisAt: startedAt, statistics },
      report: { url: `https://www.virustotal.com/gui/file/${digest}`, verifiedAt: startedAt } } : {}) };
}

function fixture(initialScan) {
  const release = structuredClone(original);
  if (initialScan) release.body = notesWithScan(intro, initialScan, download);
  let currentCommit = commit;
  let clock = Date.UTC(2026, 9, 16, 12);
  const now = () => clock++;
  const writes = [];
  const state = { release, writes, beforeRequest: undefined, afterPatch: undefined };
  const api = vi.fn(async (method, route, body) => {
    await state.beforeRequest?.(method, route, body);
    if (method === 'GET' && route === `/commits/${tag}`) return { sha: currentCommit };
    if (method === 'GET' && (route === `/releases/tags/${tag}` || route === '/releases/123')) return structuredClone(release);
    if (method === 'PATCH' && route === '/releases/123') {
      expect(Object.keys(body)).toEqual(['body']);
      release.body = body.body;
      writes.push(structuredClone(body));
      await state.afterPatch?.(body);
      return structuredClone(release);
    }
    throw new Error('Unexpected simulated API request');
  });
  const snapshot = state => ({ analysisId: submission.analysisId, installer: download.identity,
    state, observedAt: new Date(now()).toISOString(), ...(state === 'completed' ? { analysis: { analysisAt: startedAt, statistics } } : {}) });
  const virusTotal = {
    submitInstaller: vi.fn(async () => {
      expect(scanFromNotes(release.body, download)).toMatchObject({ state: 'pending', submission: { phase: 'uploading' } });
      return { analysisId: submission.analysisId, installer: download.identity, submittedAt: new Date(now()).toISOString(), ignoredPrivateField: 'not-forwarded' };
    }),
    getAnalysis: vi.fn(async () => snapshot('completed')),
    waitForAnalysis: vi.fn(async (_receipt, _download, { onUpdate }) => {
      for (const status of ['queued', 'in-progress', 'completed']) await onUpdate(snapshot(status));
      return snapshot('completed');
    }),
  };
  const fetchInstaller = vi.fn(async (_download, location) => {
    const file = path.join(location, name);
    await writeFile(file, bytes);
    return file;
  });
  const verifyReport = vi.fn(async () => true);
  const backupReceipt = vi.fn(async () => {});
  const plan = { tag, releaseId: 123, commit, download };
  const options = { api, plan, virusTotal, directory, now, download: fetchInstaller, verifyReport, backupReceipt };
  return { ...state, state, api, virusTotal, fetchInstaller, verifyReport, backupReceipt, options,
    stored: () => scanFromNotes(release.body, download), changeCommit: value => { currentCommit = value; }, advance: ms => { clock += ms; } };
}

it('validates a published stable official installer and an ancestor of trusted main without mutation', async () => {
  const f = fixture();
  const isAncestor = vi.fn(async () => true);
  expect(await releaseScanPlan({ api: f.api, tag, expectedReleaseId: 123, isAncestor })).toEqual(f.options.plan);
  expect(isAncestor).toHaveBeenCalledWith(commit);
  expect(f.writes).toEqual([]);
  await expect(releaseScanPlan({ api: f.api, tag, expectedReleaseId: 124, isAncestor })).rejects.toMatchObject({ code: 'release-id-changed' });
  await expect(releaseScanPlan({ api: f.api, tag, isAncestor: async () => false })).rejects.toMatchObject({ code: 'untrusted-tag-commit' });
});

it.each([{ draft: true }, { prerelease: true }, { assets: [] }, { published_at: null },
  { html_url: 'https://github.com/other/project/releases/tag/v1.2.3' }, { tag_name: 'v1.2.3-rc.1' }])(
  'refuses a missing, draft, prerelease or wrong-repository release', async changes => {
    const f = fixture();
    Object.assign(f.release, changes);
    await expect(releaseScanPlan({ api: f.api, tag, isAncestor: async () => true })).rejects.toMatchObject({ code: 'invalid-published-release' });
    expect(f.writes).toEqual([]);
  },
);

it('accepts only upstream main manual runs or the exact published release event', () => {
  const environment = { GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', RELEASE_TAG: tag };
  expect(scanInvocation(environment, {})).toEqual({ tag });
  for (const changes of [{ GITHUB_REPOSITORY: 'fork/opentig' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { RELEASE_TAG: 'v1.2.3;echo injected' }, { RECOVERY_ANALYSIS_ID: '../bad?id' }]) {
    expect(() => scanInvocation({ ...environment, ...changes }, {})).toThrow();
  }
  const published = { ...environment, GITHUB_EVENT_NAME: 'release', GITHUB_REF: `refs/tags/${tag}` };
  const event = { action: 'published', release: original };
  expect(scanInvocation(published, event)).toEqual({ tag, expectedReleaseId: 123 });
  for (const bad of [{ ...event, action: 'edited' }, { ...event, release: { ...original, draft: true } },
    { ...event, release: { ...original, prerelease: true } }, { ...event, release: { ...original, id: '123' } },
    { ...event, release: { ...original, tag_name: 'v1.2.4' } }]) expect(() => scanInvocation(published, bad)).toThrow();
});

it('persists intent before upload, then a minimal receipt, progress and factual completed results', async () => {
  const f = fixture();
  expect(await scanPublishedRelease(f.options)).toEqual({ state: 'completed', pollingStopped: false });
  expect(f.fetchInstaller).toHaveBeenCalledOnce();
  expect(f.virusTotal.submitInstaller).toHaveBeenCalledOnce();
  expect(f.writes.map(write => scanFromNotes(write.body, download).state)).toEqual(['pending', 'queued', 'in-progress', 'completed']);
  expect(f.writes.every(write => write.body.startsWith(intro))).toBe(true);
  expect(f.stored()).toMatchObject({ state: 'completed', submission: { phase: 'submitted', analysisId: submission.analysisId }, analysis: { statistics } });
  expect(f.stored()).not.toHaveProperty('safe');
  const backup = f.backupReceipt.mock.calls[0][0];
  expect(Object.keys(backup).sort()).toEqual(['analysisId', 'installer', 'phase', 'schemaVersion', 'startedAt', 'submittedAt'].sort());
  expect(JSON.stringify(backup)).not.toContain('not-forwarded');
});

it('connects the real coordinator, downloader and client using entirely simulated HTTP services', async () => {
  const f = fixture();
  const statuses = ['queued', 'in-progress', 'completed'];
  const transport = vi.fn(async (url, options) => {
    expect(options.headers['x-apikey']).toBe('dummy-offline-key');
    if (options.method === 'POST') {
      expect(f.stored().submission.phase).toBe('uploading');
      expect(Buffer.from(await options.body.get('file').arrayBuffer())).toEqual(bytes);
      return Response.json({ data: { type: 'analysis', id: submission.analysisId } });
    }
    if (url.endsWith('/item')) return Response.json({ data: { type: 'file', id: digest, attributes: { sha256: digest, size: bytes.length } } });
    return Response.json({ data: { type: 'analysis', id: submission.analysisId,
      attributes: { status: statuses.shift(), date: Math.floor(Date.parse(startedAt) / 1000), stats: statistics } } });
  });
  const virusTotal = createVirusTotalClient({ apiKey: 'dummy-offline-key', fetchImpl: transport,
    now: f.options.now, sleep: async ms => f.advance(ms) });
  const result = await scanPublishedRelease({ ...f.options, virusTotal,
    download: (value, location) => downloadReleaseInstaller(value, location, { fetchImpl: async () => new Response(bytes) }),
    verifyReport: value => publicReportAvailable(value, { fetchImpl: async () => new Response('GUI shell', { headers: { 'content-type': 'text/html' } }) }),
    backupReceipt: async value => { await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(value)); } });
  expect(result.state).toBe('completed');
  expect(transport).toHaveBeenCalledTimes(5);
  expect(f.stored()).toMatchObject({ state: 'completed', analysis: { analysisAt: startedAt, statistics },
    submission: { phase: 'submitted', analysisId: submission.analysisId } });
  expect(JSON.parse(await readFile(path.join(directory, 'receipt.json'), 'utf8')).analysisId).toBe(submission.analysisId);
});

it('can still persist the primary release receipt if writing its optional backup fails', async () => {
  const f = fixture();
  f.backupReceipt.mockRejectedValue(new Error('simulated backup failure'));
  await scanPublishedRelease(f.options);
  expect(f.stored()).toMatchObject({ state: 'completed', submission: { phase: 'submitted' } });
});

it('resumes from the release receipt without downloading or uploading the installer again', async () => {
  const f = fixture(scan('in-progress'));
  await scanPublishedRelease(f.options);
  expect(f.fetchInstaller).not.toHaveBeenCalled();
  expect(f.virusTotal.submitInstaller).not.toHaveBeenCalled();
  expect(f.virusTotal.waitForAnalysis.mock.calls[0][0].analysisId).toBe(submission.analysisId);
  expect(f.writes[0].body).not.toContain('"state":"pending"');
  expect(f.stored().state).toBe('completed');
});

it('a repeated completed scan is a no-op and does not spend VirusTotal quota', async () => {
  const f = fixture(scan('completed'));
  expect(await scanPublishedRelease(f.options)).toEqual({ state: 'completed', reused: true });
  expect(f.virusTotal.submitInstaller).not.toHaveBeenCalled();
  expect(f.virusTotal.getAnalysis).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
  await expect(scanPublishedRelease({ ...f.options, recoveryAnalysisId: 'other-id' })).rejects.toMatchObject({ code: 'completed-scan-cannot-be-replaced' });
});

it('can add a previously unavailable public report link without resubmitting a completed file', async () => {
  const complete = scan('completed');
  delete complete.report;
  const f = fixture(complete);
  await scanPublishedRelease(f.options);
  expect(f.virusTotal.getAnalysis).toHaveBeenCalledOnce();
  expect(f.virusTotal.submitInstaller).not.toHaveBeenCalled();
  expect(f.stored().report.url).toBe(`https://www.virustotal.com/gui/file/${digest}`);
});

it('an uncertain upload stays unavailable and subsequent runs require explicit ID recovery', async () => {
  const f = fixture();
  f.virusTotal.submitInstaller.mockRejectedValue(new VirusTotalError('submission-uncertain'));
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'submission-uncertain' });
  expect(f.stored()).toMatchObject({ state: 'unavailable', submission: { phase: 'uncertain' } });
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'submission-recovery-required' });
  expect(f.virusTotal.submitInstaller).toHaveBeenCalledOnce();
  expect(f.fetchInstaller).toHaveBeenCalledOnce();
  await scanPublishedRelease({ ...f.options, recoveryAnalysisId: submission.analysisId });
  expect(f.stored().state).toBe('completed');
  expect(f.virusTotal.submitInstaller).toHaveBeenCalledOnce();
});

it('a durable uploading intent from a lost runner is never treated as permission to upload again', async () => {
  const f = fixture(scan('pending', { phase: 'uploading', startedAt }));
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'submission-recovery-required' });
  expect(f.virusTotal.submitInstaller).not.toHaveBeenCalled();
  expect(f.stored().submission.phase).toBe('uncertain');
});

it('a quota/polling failure preserves the receipt and resumes queries instead of repeating POST', async () => {
  const f = fixture();
  f.virusTotal.waitForAnalysis.mockRejectedValueOnce(new VirusTotalError('quota-exceeded', 429));
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'quota-exceeded' });
  expect(f.stored()).toMatchObject({ state: 'unavailable', submission: { phase: 'submitted', analysisId: submission.analysisId } });
  await scanPublishedRelease(f.options);
  expect(f.virusTotal.submitInstaller).toHaveBeenCalledOnce();
  expect(f.stored().state).toBe('completed');
});

it('a definite upload rejection can be retried explicitly and a failed download never creates an upload intent', async () => {
  const f = fixture();
  f.virusTotal.submitInstaller.mockRejectedValueOnce(new VirusTotalError('upload-rejected', 403));
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'upload-rejected' });
  expect(f.stored()).not.toHaveProperty('submission');
  await scanPublishedRelease(f.options);
  expect(f.virusTotal.submitInstaller).toHaveBeenCalledTimes(2);
  const noDownload = fixture();
  noDownload.fetchInstaller.mockRejectedValue(new Error('private diagnostic'));
  await expect(scanPublishedRelease(noDownload.options)).rejects.toMatchObject({ code: 'scan-operation-failed' });
  expect(noDownload.virusTotal.submitInstaller).not.toHaveBeenCalled();
  expect(noDownload.stored()).toMatchObject({ state: 'unavailable' });
  expect(noDownload.stored()).not.toHaveProperty('submission');
});

it('retains the receipt if a PATCH succeeds remotely but its acknowledgement is lost', async () => {
  const f = fixture();
  f.state.afterPatch = async body => {
    if (scanFromNotes(body.body, download).state === 'queued') {
      f.state.afterPatch = undefined;
      throw new Error('lost acknowledgement with private diagnostic');
    }
  };
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'scan-operation-failed' });
  expect(f.backupReceipt).toHaveBeenCalledOnce();
  expect(f.stored()).toMatchObject({ state: 'unavailable', submission: { phase: 'submitted' } });
  await scanPublishedRelease(f.options);
  expect(f.virusTotal.submitInstaller).toHaveBeenCalledOnce();
});

it('keeps a completed result without a fabricated link when the public GUI route is unavailable', async () => {
  const f = fixture();
  f.verifyReport.mockResolvedValue(false);
  await scanPublishedRelease(f.options);
  expect(f.stored().state).toBe('completed');
  expect(f.stored()).not.toHaveProperty('report');
});

it('preserves an active state when the polling count is exhausted', async () => {
  const f = fixture();
  f.virusTotal.waitForAnalysis.mockImplementation(async (_receipt, _download, { onUpdate }) => {
    const active = { installer: download.identity, analysisId: submission.analysisId, state: 'in-progress' };
    await onUpdate(active);
    return { ...active, pollingStopped: true };
  });
  expect(await scanPublishedRelease(f.options)).toEqual({ state: 'in-progress', pollingStopped: true });
  expect(f.stored()).not.toHaveProperty('analysis');
  expect(f.verifyReport).not.toHaveBeenCalled();
});

it('merges prose edits detected between reads without modifying their content', async () => {
  const f = fixture();
  let reads = 0;
  f.state.beforeRequest = async (method, route) => {
    if (method === 'GET' && route === '/releases/123' && ++reads === 3) f.release.body += '\nNew manual release note.\n';
  };
  await scanPublishedRelease(f.options);
  expect(f.release.body).toContain('\nNew manual release note.\n');
  expect(f.release.body.startsWith(intro)).toBe(true);
});

it('rejects concurrent scan changes and corrupt or mismatched stored metadata', async () => {
  const f = fixture();
  let reads = 0;
  f.state.beforeRequest = async (method, route) => {
    if (method === 'GET' && route === '/releases/123' && ++reads === 3) f.release.body = notesWithScan(intro, scan('unavailable'), download);
  };
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'scan-changed-concurrently' });
  expect(f.writes).toEqual([]);
  expect(f.virusTotal.submitInstaller).not.toHaveBeenCalled();
  for (const body of [`${intro}${scanNotesStart}`, notesWithScan(intro, scan(), download).replace(digest, 'b'.repeat(64))]) {
    const invalid = fixture();
    invalid.release.body = body;
    await expect(scanPublishedRelease(invalid.options)).rejects.toMatchObject({ code: 'invalid-stored-scan' });
    expect(invalid.writes).toEqual([]);
  }
});

it('will not upload or attach a result if the published asset or tag changes during the run', async () => {
  const f = fixture();
  f.fetchInstaller.mockImplementation(async () => { f.changeCommit('b'.repeat(40)); return path.join(directory, name); });
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'release-changed' });
  expect(f.virusTotal.submitInstaller).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
  const changedAsset = fixture(scan());
  changedAsset.release.assets[0].id = 789;
  await expect(scanPublishedRelease(changedAsset.options)).rejects.toMatchObject({ code: 'release-changed' });
  expect(changedAsset.writes).toEqual([]);
});

it('rejects cross-associated provider snapshots before publishing counts or a report', async () => {
  const f = fixture();
  f.virusTotal.waitForAnalysis.mockImplementation(async (_receipt, _download, { onUpdate }) => {
    await onUpdate({ state: 'completed', analysisId: 'other-id', installer: download.identity, analysis: { analysisAt: startedAt, statistics } });
  });
  await expect(scanPublishedRelease(f.options)).rejects.toMatchObject({ code: 'invalid-analysis-snapshot' });
  expect(f.stored()).toMatchObject({ state: 'unavailable', submission: { phase: 'submitted' } });
  expect(f.stored()).not.toHaveProperty('analysis');
  expect(f.verifyReport).not.toHaveBeenCalled();
});

it('streams the official installer through approved redirects without GitHub or VirusTotal credentials', async () => {
  const fetchImpl = vi.fn(async (url, options) => {
    expect(options).not.toHaveProperty('headers');
    expect(options.redirect).toBe('manual');
    return url === download.url
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/installer?temporary=token' } })
      : new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  });
  const file = await downloadReleaseInstaller(download, directory, { fetchImpl });
  expect(await readFile(file)).toEqual(bytes);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each(['https://evil.example/file', 'http://release-assets.githubusercontent.com/file', 'https://user:password@github.com/file'])(
  'rejects untrusted download redirects without requesting them: %s', async location => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    await expect(downloadReleaseInstaller(download, directory, { fetchImpl })).rejects.toMatchObject({ code: 'untrusted-download-redirect' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  },
);

it.each([Buffer.alloc(bytes.length), bytes.subarray(0, 5), Buffer.concat([bytes, bytes])])(
  'rejects wrong hashes, truncated or oversized downloaded bytes and removes partial files', async content => {
    await expect(downloadReleaseInstaller(download, directory, { fetchImpl: async () => new Response(content) })).rejects.toThrow();
    await expect(access(path.join(directory, name))).rejects.toThrow();
  },
);

it('never overwrites or removes an existing local installer when saving verified downloaded bytes', async () => {
  const file = path.join(directory, name);
  await writeFile(file, 'existing local bytes');
  await expect(downloadReleaseInstaller(download, directory, { fetchImpl: async () => new Response(bytes) })).rejects.toMatchObject({ code: 'download-failed' });
  expect(await readFile(file, 'utf8')).toBe('existing local bytes');
});

it('checks the public GUI route with no API key, accepts only HTML success and fails closed', async () => {
  for (const [status, contentType, expected] of [[200, 'text/html; charset=utf-8', true], [200, 'application/json', false], [403, 'text/html', false]]) {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe(`https://www.virustotal.com/gui/file/${digest}`);
      expect(options).not.toHaveProperty('headers');
      expect(options.redirect).toBe('error');
      return new Response('public GUI shell', { status, headers: { 'content-type': contentType } });
    });
    expect(await publicReportAvailable(download, { fetchImpl })).toBe(expected);
  }
  expect(await publicReportAvailable(download, { fetchImpl: async () => { throw new Error('network'); } })).toBe(false);
});

it('defines a serialized upstream release scan and a main-only manual retry without website deployment', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/virustotal.yml', import.meta.url), 'utf8'));
  expect(Object.keys(workflow.on).sort()).toEqual(['release', 'workflow_dispatch']);
  expect(workflow.on.release.types).toEqual(['published']);
  expect(workflow.concurrency).toEqual({ group: 'opentig-virustotal', 'cancel-in-progress': false, queue: 'max' });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  const validate = workflow.jobs.validate;
  expect(validate.if).toContain("github.repository == 'jorgefl8/opentig'");
  expect(validate.if).toContain("github.ref == 'refs/heads/main'");
  expect(validate.steps[0].with.ref).toBe('main');
  expect(JSON.stringify(validate)).not.toContain('VIRUSTOTAL_API_KEY');
  expect(workflow.on.workflow_dispatch.inputs.diagnose_upload_url).toMatchObject({ type: 'boolean', default: false });
  expect(JSON.stringify(validate)).not.toContain('DIAGNOSE_UPLOAD_URL');
  const job = workflow.jobs.scan;
  expect(job.needs).toBe('validate');
  expect(job.environment).toBe('release-security');
  expect(job.steps[0].with.ref).toBe('${{ needs.validate.outputs.automation_commit }}');
  expect(job.steps.find(step => step.run?.includes('scan-release.mjs scan')).env.DIAGNOSE_UPLOAD_URL).toBe('${{ inputs.diagnose_upload_url }}');
  expect(job.permissions).toEqual({ contents: 'write' });
  const receipt = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact'));
  expect(receipt.if).toBe('always()');
  expect(receipt.with.path).toBe('.ai/virustotal-receipt.json');
  for (const current of [validate, job]) for (const step of current.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  expect(JSON.stringify(workflow)).not.toMatch(/deploy:website|wrangler|npm publish|release create|--clobber/);
});
