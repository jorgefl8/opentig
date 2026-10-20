import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { windowsInstaller } from '../website/src/lib/downloads.ts';
import { installerScan } from '../website/src/lib/installer-scan.ts';

const api = 'https://www.virustotal.com/api/v3';
// Decimal MB is conservative at the documented upload boundaries.
const directUploadLimit = 32_000_000;
const fileSizeLimit = 650_000_000;
const defaults = {
  minIntervalMs: 16_000, pollIntervalMs: 30_000, requestTimeoutMs: 120_000,
  maxDurationMs: 1_200_000, maxRequests: 100, maxAttempts: 3, maxPolls: 40,
};
const identityKeys = ['repository', 'version', 'releaseId', 'assetId', 'name', 'size', 'sha256'];

export class VirusTotalError extends Error {
  constructor(code, httpStatus) {
    // Never retain response messages, transport errors, credentials or upload URLs.
    super(`VirusTotal operation failed: ${code}${httpStatus ? ` (HTTP ${httpStatus})` : ''}.`);
    this.name = 'VirusTotalError';
    this.code = code;
    if (httpStatus) this.httpStatus = httpStatus;
  }
}

function expectedInstaller(download) {
  const identity = download?.identity;
  const expected = windowsInstaller({ id: identity?.releaseId, tag_name: download?.version,
    draft: false, prerelease: false, assets: [{ id: identity?.assetId, name: identity?.name,
      size: identity?.size, digest: `sha256:${identity?.sha256}`, state: 'uploaded', browser_download_url: download?.url }] })?.identity;
  if (!expected || !identityKeys.every(key => identity[key] === expected[key])) throw new VirusTotalError('invalid-installer');
  return expected;
}

function analysisId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_+=/-]{1,512}$/.test(value)) throw new VirusTotalError('invalid-analysis-id');
  return value;
}

function virusTotalHost(hostname) {
  return hostname === 'virustotal.com' || hostname.endsWith('.virustotal.com');
}

function uploadLocation(value) {
  let url;
  try { url = new URL(value); } catch { throw new VirusTotalError('invalid-upload-url'); }
  // The one-time URL may use http on a provider host. Upgrade only that host.
  if (url.protocol === 'http:' && virusTotalHost(url.hostname) && !url.port
    && !url.username && !url.password) url.protocol = 'https:';
  if (url.protocol !== 'https:' || !virusTotalHost(url.hostname) || url.port
    || url.username || url.password || url.hash || !url.pathname.startsWith('/_ah/upload/')
    || url.pathname === '/_ah/upload/') throw new VirusTotalError('invalid-upload-url');
  return url.href;
}

function uploadUrlShape(value) {
  const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (typeof value !== 'string') return { valueType };
  let url;
  try { url = new URL(value); } catch {
    return { valueType: 'string', parseable: false, stringLength: value.length };
  }
  const hostClass = url.hostname === 'www.virustotal.com' ? 'expected'
    : url.hostname === 'virustotal.com' ? 'apex'
    : virusTotalHost(url.hostname) ? 'provider-subdomain'
    : url.hostname === 'storage.googleapis.com' ? 'google-storage'
    : 'other';
  const protocol = url.protocol === 'https:' ? 'https' : url.protocol === 'http:' ? 'http' : 'other';
  let pathClass = 'other';
  if (url.pathname === '/_ah/upload' || url.pathname === '/_ah/upload/') pathClass = 'legacy-root';
  else if (url.pathname.startsWith('/_ah/upload/')) pathClass = 'legacy-token';
  else if (url.pathname === '/api/v3/files' || url.pathname.startsWith('/api/v3/files/')) pathClass = 'api-files';
  else if (url.pathname.startsWith('/api/v3/')) pathClass = 'api-v3';
  let accepted;
  try { uploadLocation(value); accepted = true; } catch { accepted = false; }
  return {
    valueType: 'string', parseable: true, accepted, protocol, hostClass, pathClass,
    pathSegments: url.pathname.split('/').filter(Boolean).length, stringLength: value.length,
    hasPort: Boolean(url.port), hasUserInfo: Boolean(url.username || url.password),
    hasFragment: Boolean(url.hash), hasQuery: Boolean(url.search), queryKeyCount: [...url.searchParams.keys()].length,
  };
}

function retryDelay(header, now, fallback) {
  if (!header) return fallback;
  if (/^\d+$/.test(header)) {
    const milliseconds = Number(header) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : Infinity;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : fallback;
}

/** Internal Node client. Importing this module never reads secrets or makes requests. */
export function createVirusTotalClient({ apiKey, fetchImpl = fetch, now = Date.now,
  sleep = (ms, signal) => delay(ms, undefined, { signal }), signal, limits: overrides = {} } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new VirusTotalError('missing-api-key');
  const limits = { ...defaults, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(defaults, key) || !Number.isSafeInteger(value) || value <= 0
      || (key === 'minIntervalMs' || key === 'pollIntervalMs' ? value < 16_000 : value > defaults[key])) {
      throw new VirusTotalError('invalid-limits');
    }
  }
  const startedAt = now();
  let nextRequestAt = startedAt + limits.minIntervalMs;
  let requests = 0;
  let quotaExhausted = false;
  let tail = Promise.resolve();

  function remaining() {
    if (quotaExhausted) throw new VirusTotalError('quota-exceeded', 429);
    if (signal?.aborted) throw new VirusTotalError('cancelled');
    const time = limits.maxDurationMs - (now() - startedAt);
    if (time <= 0) throw new VirusTotalError('time-budget-exhausted');
    return time;
  }

  async function pauseUntil(target) {
    const wait = Math.max(0, target - now());
    if (wait >= remaining()) throw new VirusTotalError('time-budget-exhausted');
    if (wait) {
      try { await sleep(wait, signal); } catch { throw new VirusTotalError(signal?.aborted ? 'cancelled' : 'wait-failed'); }
    }
    remaining();
  }

  async function requestNow(url, { method = 'GET', body } = {}) {
    for (let attempt = 0; attempt < limits.maxAttempts; attempt++) {
      if (requests >= limits.maxRequests) throw new VirusTotalError('request-budget-exhausted');
      await pauseUntil(nextRequestAt);
      const timeout = Math.min(limits.requestTimeoutMs, remaining());
      const timeoutSignal = AbortSignal.timeout(timeout);
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      nextRequestAt = now() + limits.minIntervalMs;
      requests++;
      let response;
      let json;
      try {
        response = await fetchImpl(url, { method, body, redirect: 'error', credentials: 'omit',
          referrerPolicy: 'no-referrer', headers: { 'x-apikey': apiKey, Accept: 'application/json' }, signal: requestSignal });
        try { json = await response.json(); } catch {
          if (response.ok || requestSignal.aborted) throw new Error('Unreadable response');
        }
      } catch {
        if (method !== 'GET') throw new VirusTotalError('submission-uncertain');
        if (signal?.aborted) throw new VirusTotalError('cancelled');
        remaining();
        if (response && !timeoutSignal.aborted) throw new VirusTotalError('invalid-response', response.status);
        nextRequestAt = Math.max(nextRequestAt, now() + 16_000 * 2 ** attempt);
        if (attempt + 1 === limits.maxAttempts) throw new VirusTotalError('request-failed');
        continue;
      }
      if (method === 'GET') remaining();
      if (response.status >= 200 && response.status < 300) return json;
      if (response.status === 429 && json?.error?.code === 'QuotaExceededError') {
        quotaExhausted = true;
        throw new VirusTotalError('quota-exceeded', 429);
      }
      const retryable = response.status === 429 || response.status >= 500
        || response.status === 400 && json?.error?.code === 'NotAvailableYet';
      if (retryable) {
        const fallback = response.status === 429 ? 60_000 * 2 ** attempt : 16_000 * 2 ** attempt;
        nextRequestAt = Math.max(nextRequestAt, now() + retryDelay(response.headers.get('retry-after'), now(), fallback));
      }
      if (method !== 'GET') {
        throw new VirusTotalError(response.status >= 500 ? 'submission-uncertain' : 'upload-rejected', response.status);
      }
      if (!retryable || attempt + 1 === limits.maxAttempts) throw new VirusTotalError('http-error', response.status);
    }
    throw new VirusTotalError('request-failed');
  }

  function request(url, options) {
    // The shared queue includes retries so concurrent callers cannot skip backoff.
    const operation = tail.then(() => requestNow(url, options));
    tail = operation.catch(() => {});
    return operation;
  }

  function receiptIdentity(receipt, download) {
    const installer = expectedInstaller(download);
    if (!identityKeys.every(key => receipt?.installer?.[key] === installer[key])) throw new VirusTotalError('receipt-mismatch');
    return { installer, id: analysisId(receipt.analysisId) };
  }

  async function submitInstaller(file, download) {
    remaining();
    const installer = expectedInstaller(download);
    if (path.basename(file) !== installer.name || installer.size > fileSizeLimit) throw new VirusTotalError('invalid-installer');
    let blob;
    try {
      blob = await openAsBlob(file);
      if (blob.size !== installer.size) throw new VirusTotalError('file-mismatch');
      const hash = createHash('sha256');
      for await (const chunk of blob.stream()) { remaining(); hash.update(chunk); }
      if (hash.digest('hex') !== installer.sha256) throw new VirusTotalError('file-mismatch');
    } catch (error) {
      if (error instanceof VirusTotalError) throw error;
      throw new VirusTotalError('file-unavailable');
    }
    const url = blob.size > directUploadLimit ? uploadLocation((await request(`${api}/files/upload_url`))?.data) : `${api}/files`;
    const form = new FormData();
    form.set('file', blob, installer.name);
    const result = await request(url, { method: 'POST', body: form });
    if (result?.data?.type !== 'analysis') throw new VirusTotalError('submission-uncertain');
    let id;
    try { id = analysisId(result.data.id); } catch { throw new VirusTotalError('submission-uncertain'); }
    return { analysisId: id, installer, submittedAt: new Date(now()).toISOString() };
  }

  async function getAnalysis(receipt, download) {
    const { installer, id } = receiptIdentity(receipt, download);
    const result = await request(`${api}/analyses/${encodeURIComponent(id)}`);
    const data = result?.data;
    const status = data?.attributes?.status;
    const info = result?.meta?.file_info;
    // The submission id addresses the analysis. A later response may use another id
    // once its file metadata matches this installer.
    const sameFile = info?.sha256 === installer.sha256 && info?.size === installer.size;
    if (data?.type !== 'analysis' || !['queued', 'in-progress', 'completed'].includes(status)
      || (data.id !== id && !sameFile)) {
      throw new VirusTotalError('invalid-analysis-response');
    }
    // File metadata on a fresh upload can be provisional until the analysis completes.
    if (status === 'completed' && info && !sameFile) throw new VirusTotalError('analysis-file-mismatch');
    const observedAt = new Date(now()).toISOString();
    if (status !== 'completed') return { analysisId: id, installer, state: status, observedAt };
    const attributes = data.attributes;
    if (!Number.isSafeInteger(attributes.date) || attributes.date <= 0 || attributes.date > Math.floor(now() / 1000)) {
      throw new VirusTotalError('invalid-analysis-response');
    }
    const validated = installerScan({ schemaVersion: 1, installer, state: 'completed', updatedAt: observedAt,
      analysis: { analysisAt: new Date(attributes.date * 1000).toISOString(), statistics: attributes.stats } }, download);
    if (!validated) throw new VirusTotalError('invalid-analysis-response');
    const item = (await request(`${api}/analyses/${encodeURIComponent(id)}/item`))?.data;
    if (item?.type !== 'file' || item.id !== installer.sha256 || item.attributes?.sha256 !== installer.sha256
      || item.attributes?.size !== installer.size) throw new VirusTotalError('analysis-file-mismatch');
    return { analysisId: id, installer, state: status, observedAt: new Date(now()).toISOString(),
      analysis: { analysisAt: new Date(attributes.date * 1000).toISOString(), statistics: validated.analysis.statistics } };
  }

  async function waitForAnalysis(receipt, download, { onUpdate = async () => {} } = {}) {
    for (let poll = 0; poll < limits.maxPolls; poll++) {
      const result = await getAnalysis(receipt, download);
      await onUpdate(result);
      if (result.state === 'completed') return result;
      if (poll + 1 === limits.maxPolls) return { ...result, pollingStopped: true };
      await pauseUntil(now() + limits.pollIntervalMs);
    }
    throw new VirusTotalError('poll-budget-exhausted');
  }

  async function diagnoseUploadUrl() {
    // Fixed labels only. Never return the URL, host, path, query, or token.
    return uploadUrlShape((await request(`${api}/files/upload_url`))?.data);
  }

  function valueClass(value) {
    if (value === undefined) return 'missing';
    if (value === null) return 'null';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return Number.isSafeInteger(value) ? 'integer' : 'number';
    return 'other';
  }

  function identityComparison(actual, expected) {
    let numericMatch = false;
    if (typeof expected === 'number') {
      if (typeof actual === 'number') numericMatch = actual === expected;
      else if (typeof actual === 'string' && /^[0-9]+$/.test(actual)) {
        const parsed = Number(actual);
        numericMatch = Number.isSafeInteger(parsed) && String(parsed) === actual && parsed === expected;
      }
    }
    return {
      present: actual !== undefined && actual !== null, kind: valueClass(actual),
      strictMatch: actual === expected, numericMatch,
      stringLength: typeof actual === 'string' ? actual.length : 0,
    };
  }

  async function diagnoseAnalysis(receipt, download) {
    // Fixed labels only. Never return hashes, identifiers, sizes, or provider text.
    const { installer, id } = receiptIdentity(receipt, download);
    const result = await request(`${api}/analyses/${encodeURIComponent(id)}`);
    const data = result?.data;
    const status = data?.attributes?.status;
    const info = result?.meta?.file_info;
    const shape = {
      analysisType: data?.type === 'analysis' ? 'analysis' : 'other',
      idMatch: data?.id === id,
      status: ['queued', 'in-progress', 'completed'].includes(status) ? status : 'other',
      fileInfo: info === undefined ? 'missing' : info && typeof info === 'object' && !Array.isArray(info) ? 'object' : 'other',
      strictFileInfoRejects: Boolean(info && (info.sha256 !== installer.sha256 || info.size !== installer.size)),
    };
    if (shape.fileInfo === 'object') {
      shape.sha256 = identityComparison(info.sha256, installer.sha256);
      shape.size = identityComparison(info.size, installer.size);
    }
    if (status !== 'completed') return shape;
    try {
      const item = (await request(`${api}/analyses/${encodeURIComponent(id)}/item`))?.data;
      shape.itemType = item?.type === 'file' ? 'file' : 'other';
      shape.itemId = identityComparison(item?.id, installer.sha256);
      shape.itemSha256 = identityComparison(item?.attributes?.sha256, installer.sha256);
      shape.itemSize = identityComparison(item?.attributes?.size, installer.size);
    } catch (error) {
      shape.item = error instanceof VirusTotalError ? error.code : 'request-failed';
    }
    return shape;
  }

  return Object.freeze({ submitInstaller, getAnalysis, waitForAnalysis, diagnoseUploadUrl, diagnoseAnalysis });
}
