import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { windowsInstaller } from '../website/src/lib/downloads.ts';
import { createVirusTotalClient, VirusTotalError } from './virustotal-client.mjs';

const api = 'https://www.virustotal.com/api/v3';
const testKey = 'dummy-api-key-for-offline-tests';
const id = 'analysis/opaque+id==';
const statistics = { malicious: 1, suspicious: 2, harmless: 0, undetected: 60,
  timeout: 1, 'confirmed-timeout': 2, failure: 3, 'type-unsupported': 4 };
let directory;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'opentig-vt-client-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const response = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });
const submitted = () => response({ data: { type: 'analysis', id } });

async function installer(size = 128) {
  const name = 'OpenTig-1.2.3-win32-x64-Setup.exe';
  const file = path.join(directory, name);
  const handle = await open(file, 'w');
  try { await handle.truncate(size); } finally { await handle.close(); }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const download = windowsInstaller({ id: 123, tag_name: 'v1.2.3', draft: false, prerelease: false,
    assets: [{ id: 456, size, name, digest: `sha256:${sha256}`, state: 'uploaded',
      browser_download_url: `https://github.com/jorgefl8/opentig/releases/download/v1.2.3/${name}` }] });
  return { file, download, receipt: { analysisId: id, installer: download.identity } };
}

function client(handler, limits, signal) {
  let time = Date.UTC(2026, 9, 16, 12);
  const waits = [];
  const calls = [];
  const fetchImpl = vi.fn(async (url, options) => {
    calls.push({ url, options, time });
    return handler(url, options, calls.length);
  });
  const instance = createVirusTotalClient({ apiKey: testKey, fetchImpl, now: () => time,
    sleep: async ms => { waits.push(ms); time += ms; }, limits, signal });
  return { ...instance, calls, waits, fetchImpl, now: () => time };
}

function analysis(state, extra = {}) {
  return response({ data: { type: 'analysis', id,
    attributes: { status: state, date: 1792151900, stats: statistics }, ...extra } });
}

function item(download, extra = {}) {
  return response({ data: { type: 'file', id: download.identity.sha256,
    attributes: { sha256: download.identity.sha256, size: download.identity.size }, ...extra } });
}

it('uploads the verified bytes and exact filename using multipart with no manual content type', async () => {
  const fixture = await installer();
  const vt = client(async (url, options) => {
    expect(url).toBe(`${api}/files`);
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    expect(options.headers['x-apikey']).toBe(testKey);
    expect(options.headers).not.toHaveProperty('Content-Type');
    const file = options.body.get('file');
    expect(file.name).toBe(fixture.download.identity.name);
    expect(file.size).toBe(128);
    expect(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')).toBe(fixture.download.identity.sha256);
    return submitted();
  });
  const result = await vt.submitInstaller(fixture.file, fixture.download);
  expect(result).toEqual({ analysisId: id, installer: fixture.download.identity, submittedAt: new Date(vt.now()).toISOString() });
  expect(result).not.toHaveProperty('report');
  expect(vt.calls).toHaveLength(1);
  expect(vt.waits).toEqual([16_000]);
});

it('uses a single-use large-upload URL for files over 32 MB and counts both calls', async () => {
  const fixture = await installer(32_000_001);
  const uploadUrl = 'https://www.virustotal.com/_ah/upload/one-use-token';
  const vt = client((url, options, call) => {
    if (call === 1) {
      expect(url).toBe(`${api}/files/upload_url`);
      expect(options.method).toBe('GET');
      return response({ data: uploadUrl });
    }
    expect(url).toBe(uploadUrl);
    expect(options.body.get('file').size).toBe(32_000_001);
    return submitted();
  });
  expect((await vt.submitInstaller(fixture.file, fixture.download)).installer).toEqual(fixture.download.identity);
  expect(vt.calls.map(call => call.time)).toEqual([vt.calls[0].time, vt.calls[0].time + 16_000]);
});

it('upgrades the documented http upload URL to https before posting the installer', async () => {
  const fixture = await installer(32_000_001);
  const pathName = '/_ah/upload/AMmfu6b-_DXUeFe36Sb3b0F4B8mH9Nb-CHbRoUNVOPwG/';
  const vt = client((url, options, call) => {
    if (call === 1) return response({ data: `http://www.virustotal.com${pathName}` });
    expect(url).toBe(`https://www.virustotal.com${pathName}`);
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(options.headers['x-apikey']).toBe(testKey);
    expect(options.body.get('file').size).toBe(32_000_001);
    return submitted();
  });
  expect((await vt.submitInstaller(fixture.file, fixture.download)).installer).toEqual(fixture.download.identity);
  expect(vt.calls).toHaveLength(2);
  expect(vt.calls.every(call => !String(call.url).startsWith('http://'))).toBe(true);
});

it.each([
  ['https://www.virustotal.com/_ah/upload/private-token', { accepted: true, protocol: 'https', hostClass: 'expected', pathClass: 'legacy-token', pathSegments: 3, hasQuery: false }],
  ['http://www.virustotal.com/_ah/upload/private-token/', { accepted: true, protocol: 'http', hostClass: 'expected', pathClass: 'legacy-token', pathSegments: 3 }],
  ['https://www.virustotal.com/_ah/upload/?upload_id=private-token', { accepted: false, hostClass: 'expected', pathClass: 'legacy-root', hasQuery: true, queryKeyCount: 1 }],
  ['https://upload.virustotal.com/_ah/upload/private-token', { accepted: false, hostClass: 'provider-subdomain', pathClass: 'legacy-token' }],
  ['https://virustotal.com/_ah/upload/private-token', { accepted: false, hostClass: 'apex', pathClass: 'legacy-token' }],
  ['https://storage.googleapis.com/bucket/private-token', { accepted: false, hostClass: 'google-storage', pathClass: 'other', pathSegments: 2 }],
  ['https://private-token.example/_ah/upload/private-token', { accepted: false, protocol: 'https', hostClass: 'other', pathClass: 'legacy-token' }],
])('diagnoses an upload URL without disclosing its token or uploading: %s', async (uploadUrl, expected) => {
  const vt = client(() => response({ data: uploadUrl }));
  const result = await vt.diagnoseUploadUrl();
  expect(result).toMatchObject({ valueType: 'string', parseable: true, ...expected });
  expect(JSON.stringify(result)).not.toMatch(/private-token|example|virustotal|googleapis|bucket|https?:\/\//);
  expect(vt.calls).toEqual([expect.objectContaining({ url: `${api}/files/upload_url` })]);
  expect(vt.calls[0].options.method ?? 'GET').toBe('GET');
});

it.each([null, 4, { url: 'https://www.virustotal.com/_ah/upload/private-token' }])(
  'diagnoses a non-string upload URL without echoing it: %j', async value => {
    const vt = client(() => response({ data: value }));
    const result = await vt.diagnoseUploadUrl();
    expect(result).toEqual({ valueType: value === null ? 'null' : typeof value });
    expect(JSON.stringify(result)).not.toMatch(/private-token|virustotal|https?:\/\//);
  },
);

it('diagnoses an unparseable upload URL string without echoing it', async () => {
  const secret = 'not a url private-token';
  const vt = client(() => response({ data: secret }));
  expect(await vt.diagnoseUploadUrl()).toEqual({ valueType: 'string', parseable: false, stringLength: secret.length });
});

it('rejects wrong bytes, sizes, names, identities and oversized files before making any request', async () => {
  const fixture = await installer();
  const vt = client(() => { throw new Error('Must not call the network'); });
  const changed = { ...fixture.download, identity: { ...fixture.download.identity, sha256: 'b'.repeat(64) } };
  await expect(vt.submitInstaller(fixture.file, changed)).rejects.toMatchObject({ code: 'file-mismatch' });
  await expect(vt.submitInstaller(fixture.file, { ...fixture.download, identity: { ...fixture.download.identity, size: 129 } })).rejects.toMatchObject({ code: 'file-mismatch' });
  await expect(vt.submitInstaller(path.join(directory, 'other.exe'), fixture.download)).rejects.toMatchObject({ code: 'invalid-installer' });
  await expect(vt.submitInstaller(fixture.file, { ...fixture.download, version: 'v1.2.4' })).rejects.toMatchObject({ code: 'invalid-installer' });
  await expect(vt.submitInstaller(fixture.file, { ...fixture.download, url: 'https://example.com/file' })).rejects.toMatchObject({ code: 'invalid-installer' });
  await expect(vt.submitInstaller(fixture.file, { ...fixture.download, identity: { ...fixture.download.identity, size: 650_000_001 } })).rejects.toMatchObject({ code: 'invalid-installer' });
  await expect(vt.submitInstaller(fixture.file, { ...fixture.download, identity: undefined })).rejects.toMatchObject({ code: 'invalid-installer' });
  await rm(fixture.file);
  await expect(vt.submitInstaller(fixture.file, fixture.download)).rejects.toMatchObject({ code: 'file-unavailable' });
  expect(vt.calls).toEqual([]);
});

it.each(['http://evil.example/_ah/upload/token', 'http://www.virustotal.com:444/_ah/upload/token',
  'http://user:password@www.virustotal.com/_ah/upload/token', 'http://www.virustotal.com/_ah/upload/token#fragment',
  'http://www.virustotal.com/_ah/upload/', 'http://www.virustotal.com/api/v3/files',
  'https://evil.example/_ah/upload/token', 'https://www.virustotal.com.evil.example/_ah/upload/token',
  'https://www.virustotal.com:444/_ah/upload/token', 'https://user:password@www.virustotal.com/_ah/upload/token',
  'https://www.virustotal.com/api/v3/files', 'https://www.virustotal.com/_ah/upload/',
  'https://www.virustotal.com/_ah/upload/token#fragment', 'not-a-url'])(
  'refuses an unexpected upload location without forwarding file data or credentials: %s', async uploadUrl => {
    const fixture = await installer();
    // Use a sparse large file and its real digest without allocating its bytes in memory.
    const large = { ...fixture.download, identity: { ...fixture.download.identity, size: 32_000_001 } };
    const handle = await open(fixture.file, 'r+');
    try { await handle.truncate(large.identity.size); } finally { await handle.close(); }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(fixture.file)) hash.update(chunk);
    large.identity.sha256 = hash.digest('hex');
    const vt = client(() => response({ data: uploadUrl }));
    await expect(vt.submitInstaller(fixture.file, large)).rejects.toMatchObject({ code: 'invalid-upload-url' });
    expect(vt.calls).toHaveLength(1);
  },
);

it.each(['queued', 'in-progress'])('keeps %s results partial without returning counters or a report URL', async state => {
  const fixture = await installer();
  const vt = client(() => analysis(state));
  const result = await vt.getAnalysis(fixture.receipt, fixture.download);
  expect(result.state).toBe(state);
  expect(result).not.toHaveProperty('analysis');
  expect(result).not.toHaveProperty('report');
  expect(vt.calls).toHaveLength(1);
  expect(vt.calls[0].url).toBe(`${api}/analyses/${encodeURIComponent(id)}`);
});

it('checks the completed analysis relationship against the exact SHA-256 and size', async () => {
  const fixture = await installer();
  const vt = client((url, _options, call) => {
    if (call === 1) return analysis('completed');
    expect(url).toBe(`${api}/analyses/${encodeURIComponent(id)}/item`);
    return item(fixture.download);
  });
  const result = await vt.getAnalysis(fixture.receipt, fixture.download);
  expect(result.state).toBe('completed');
  expect(result.analysis).toEqual({ analysisAt: new Date(1792151900 * 1000).toISOString(), statistics });
  expect(result).not.toHaveProperty('report');
  expect(result).not.toHaveProperty('safe');
  expect(vt.calls).toHaveLength(2);
});

it.each([{ type: 'url' }, { id: 'b'.repeat(64) }, { attributes: { sha256: 'b'.repeat(64), size: 128 } },
  { attributes: { sha256: 'a'.repeat(64), size: 129 } }, { attributes: {} }])(
  'rejects a completed analysis associated with a different or missing file', async extra => {
    const fixture = await installer();
    const vt = client((_url, _options, call) => call === 1 ? analysis('completed') : item(fixture.download, extra));
    await expect(vt.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'analysis-file-mismatch' });
  },
);

it('rejects mismatched receipts and responses without guessing an analysis ID from the file hash', async () => {
  const fixture = await installer();
  const vt = client(() => analysis('completed', { id: 'different-id' }));
  await expect(vt.getAnalysis({ ...fixture.receipt, installer: { ...fixture.receipt.installer, assetId: 789 } }, fixture.download)).rejects.toMatchObject({ code: 'receipt-mismatch' });
  await expect(vt.getAnalysis({ ...fixture.receipt, analysisId: '../bad?id=other' }, fixture.download)).rejects.toMatchObject({ code: 'invalid-analysis-id' });
  expect(vt.calls).toHaveLength(0);
  await expect(vt.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'invalid-analysis-response' });
});

it.each([{}, { status: 'unknown' }, { status: 'completed', date: '1792151900', stats: statistics },
  { status: 'completed', date: 9999999999, stats: statistics },
  { status: 'completed', date: 1792151900, stats: { malicious: 0 } },
  { status: 'completed', date: 1792151900, stats: { ...statistics, failure: -1 } }])(
  'rejects invalid or incomplete results without converting absent counters to zero', async attributes => {
    const fixture = await installer();
    const vt = client(() => response({ data: { type: 'analysis', id, attributes } }));
    await expect(vt.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'invalid-analysis-response' });
    expect(vt.calls).toHaveLength(1);
  },
);

it('rejects mismatched file metadata even while an analysis is queued', async () => {
  const fixture = await installer();
  const vt = client(() => response({ data: { type: 'analysis', id, attributes: { status: 'queued' } },
    meta: { file_info: { sha256: 'b'.repeat(64), size: 128 } } }));
  await expect(vt.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'analysis-file-mismatch' });
});

it('serializes concurrent callers, including an initial cooldown and every API call', async () => {
  const fixture = await installer();
  const vt = client(() => analysis('queued'));
  const results = await Promise.all(Array.from({ length: 5 }, () => vt.getAnalysis(fixture.receipt, fixture.download)));
  expect(results.every(result => result.state === 'queued')).toBe(true);
  expect(vt.waits).toEqual([16_000, 16_000, 16_000, 16_000, 16_000]);
  expect(vt.calls[4].time - vt.calls[0].time).toBe(64_000);
});

it.each(['90', new Date(Date.UTC(2026, 9, 16, 12, 2)).toUTCString()])('honors Retry-After %s without exceeding the request budget', async header => {
  const fixture = await installer();
  const vt = client((_url, _options, call) => call === 1
    ? response({ error: { code: 'TooManyRequestsError' } }, 429, { 'Retry-After': header }) : analysis('queued'));
  expect((await vt.getAnalysis(fixture.receipt, fixture.download)).state).toBe('queued');
  expect(vt.calls[1].time - vt.calls[0].time).toBeGreaterThanOrEqual(90_000);
});

it('bounds repeated 429 retries and stops the entire client on a quota-exceeded response', async () => {
  const fixture = await installer();
  const limited = client(() => response({ error: { code: 'TooManyRequestsError', message: testKey } }, 429));
  await expect(limited.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'http-error', httpStatus: 429 });
  expect(limited.calls).toHaveLength(3);
  expect(limited.waits).toEqual([16_000, 60_000, 120_000]);
  const quota = client(() => response({ error: { code: 'QuotaExceededError' } }, 429));
  await expect(quota.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'quota-exceeded' });
  await expect(quota.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'quota-exceeded' });
  expect(quota.calls).toHaveLength(1);
});

it.each([302, 401, 403, 404])('does not retry HTTP %s or expose API response messages', async status => {
  const fixture = await installer();
  const vt = client(() => response({ error: { message: `${testKey} private-upload-url` } }, status));
  const error = await vt.getAnalysis(fixture.receipt, fixture.download).catch(error => error);
  expect(error).toBeInstanceOf(VirusTotalError);
  expect(error.httpStatus).toBe(status);
  expect(String(error)).not.toContain(testKey);
  expect(String(error)).not.toContain('private-upload-url');
  expect(error).not.toHaveProperty('cause');
  expect(vt.calls).toHaveLength(1);
});

it('retries GET transport errors, non-JSON 503 responses and NotAvailableYet with bounded backoff', async () => {
  const fixture = await installer();
  const vt = client((_url, _options, call) => {
    if (call === 1) throw new Error(`Network log containing ${testKey}`);
    if (call === 2) return new Response('Service unavailable', { status: 503 });
    return analysis('queued');
  });
  expect((await vt.getAnalysis(fixture.receipt, fixture.download)).state).toBe('queued');
  expect(vt.waits).toEqual([16_000, 16_000, 32_000]);
  const later = client((_url, _options, call) => call === 1
    ? response({ error: { code: 'NotAvailableYet' } }, 400) : analysis('queued'));
  expect((await later.getAnalysis(fixture.receipt, fixture.download)).state).toBe('queued');
  const corrupt = client(() => new Response('Not JSON', { status: 200 }));
  await expect(corrupt.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'invalid-response' });
  expect(corrupt.calls).toHaveLength(1);
});

it.each(['network', 'server', 'invalid-json', 'missing-id', 'invalid-id'])('does not replay a POST after an uncertain upload: %s', async failure => {
  const fixture = await installer();
  const vt = client(() => {
    if (failure === 'network') throw new Error(`${testKey} sensitive transport diagnostic`);
    if (failure === 'server') return response({ error: { message: testKey } }, 503);
    if (failure === 'invalid-json') return new Response('Not JSON');
    return response({ data: { type: 'analysis', ...(failure === 'invalid-id' ? { id: '../bad?id' } : {}) } });
  });
  const error = await vt.submitInstaller(fixture.file, fixture.download).catch(error => error);
  expect(error).toMatchObject({ code: 'submission-uncertain' });
  expect(String(error)).not.toContain(testKey);
  expect(vt.calls).toHaveLength(1);
});

it('does not reuse a single-use URL when a large upload is rejected', async () => {
  const fixture = await installer(32_000_001);
  const vt = client((_url, _options, call) => call === 1
    ? response({ data: 'https://www.virustotal.com/_ah/upload/one-use' })
    : response({ error: { code: 'TooManyRequestsError' } }, 429));
  await expect(vt.submitInstaller(fixture.file, fixture.download)).rejects.toMatchObject({ code: 'upload-rejected', httpStatus: 429 });
  expect(vt.calls).toHaveLength(2);
});

it('preserves server backoff for later calls even after a rejected POST or exhausted GET retry', async () => {
  const fixture = await installer();
  const vt = client((_url, _options, call) => call === 1
    ? response({}, 429, { 'Retry-After': '90' }) : analysis('queued'), { maxAttempts: 1 });
  await expect(vt.submitInstaller(fixture.file, fixture.download)).rejects.toMatchObject({ code: 'upload-rejected' });
  await vt.getAnalysis(fixture.receipt, fixture.download);
  expect(vt.calls[1].time - vt.calls[0].time).toBe(90_000);
  const exhausted = client((_url, _options, call) => call === 1
    ? response({}, 429, { 'Retry-After': '90' }) : analysis('queued'), { maxAttempts: 1 });
  await expect(exhausted.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'http-error' });
  await exhausted.getAnalysis(fixture.receipt, fixture.download);
  expect(exhausted.calls[1].time - exhausted.calls[0].time).toBe(90_000);
});

it('enforces total request/time budgets and never shortens Retry-After to fit', async () => {
  const fixture = await installer();
  const budget = client(() => analysis('queued'), { maxRequests: 1 });
  await budget.getAnalysis(fixture.receipt, fixture.download);
  await expect(budget.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'request-budget-exhausted' });
  expect(budget.calls).toHaveLength(1);
  const timeout = client(() => analysis('queued'), { maxDurationMs: 16_000 });
  await expect(timeout.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'time-budget-exhausted' });
  expect(timeout.calls).toHaveLength(0);
  const retry = client(() => response({}, 429, { 'Retry-After': '999999999999999999999' }));
  await expect(retry.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'time-budget-exhausted' });
  expect(retry.calls).toHaveLength(1);
});

it('returns the last active state when polling is exhausted and can later resume by receipt', async () => {
  const fixture = await installer();
  const vt = client((_url, _options, call) => call < 3 ? analysis('in-progress')
    : call === 3 ? analysis('completed') : item(fixture.download), { maxPolls: 2 });
  const result = await vt.waitForAnalysis(fixture.receipt, fixture.download);
  expect(result).toMatchObject({ state: 'in-progress', pollingStopped: true });
  expect(result).not.toHaveProperty('analysis');
  expect((await vt.waitForAnalysis(fixture.receipt, fixture.download)).state).toBe('completed');
  expect(vt.calls).toHaveLength(4);
  expect(vt.waits.slice(0, 2)).toEqual([16_000, 30_000]);
});

it('honors cancellation before any request and timeouts during a GET without leaking transport errors', async () => {
  const fixture = await installer();
  const controller = new AbortController();
  controller.abort(new Error(testKey));
  const cancelled = client(() => analysis('queued'), undefined, controller.signal);
  await expect(cancelled.getAnalysis(fixture.receipt, fixture.download)).rejects.toMatchObject({ code: 'cancelled' });
  expect(cancelled.calls).toHaveLength(0);
  const timeout = client((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(testKey)), { once: true });
  }), { requestTimeoutMs: 10, maxAttempts: 2 });
  const error = await timeout.getAnalysis(fixture.receipt, fixture.download).catch(error => error);
  expect(error).toMatchObject({ code: 'request-failed' });
  expect(String(error)).not.toContain(testKey);
  expect(timeout.calls).toHaveLength(2);
});

it('detects file changes after verification rather than sending different bytes', async () => {
  const fixture = await installer();
  let bytesRead = false;
  const vt = createVirusTotalClient({ apiKey: testKey, sleep: async () => { await writeFile(fixture.file, 'changed'); },
    fetchImpl: async (_url, options) => {
      await options.body.get('file').arrayBuffer();
      bytesRead = true;
      return submitted();
    } });
  await expect(vt.submitInstaller(fixture.file, fixture.download)).rejects.toMatchObject({ code: 'submission-uncertain' });
  expect(bytesRead).toBe(false);
});

it('requires an explicit key and refuses settings that bypass public API throttling or budgets', () => {
  expect(() => createVirusTotalClient()).toThrow(VirusTotalError);
  expect(() => createVirusTotalClient({ apiKey: '\nprivate' })).toThrow(VirusTotalError);
  for (const limits of [{ minIntervalMs: 1000 }, { pollIntervalMs: 1000 }, { maxRequests: 501 },
    { maxDurationMs: Infinity }, { maxAttempts: 10 }, { maxPolls: 0 }, { unexpected: 1 }, { toString: 1 }]) {
    expect(() => client(() => analysis('queued'), limits)).toThrow(VirusTotalError);
  }
});
