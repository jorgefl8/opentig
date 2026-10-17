import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdtemp, readFile, rm, writeFile, mkdir, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { windowsInstaller } from '../website/src/lib/downloads.ts';
import { installerScan } from '../website/src/lib/installer-scan.ts';
import { notesWithScan, scanFromNotes, scanNotesStart, scanNotesEnd } from '../website/src/lib/installer-scan-notes.ts';
import { releaseApi } from './release-api.mjs';
import { createVirusTotalClient } from './virustotal-client.mjs';

const repository = 'jorgefl8/opentig';
const stableTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const sha = /^[a-f0-9]{40}$/;
const idPattern = /^[A-Za-z0-9_+=/-]{1,512}$/;
const sameIdentity = (a, b) => !!a && !!b && ['repository', 'version', 'releaseId', 'assetId', 'name', 'size', 'sha256'].every(key => a[key] === b[key]);

export class ReleaseScanError extends Error {
  constructor(code) { super(`Release scan failed: ${code}.`); this.name = 'ReleaseScanError'; this.code = code; }
}

function publishedInstaller(release, tag) {
  const download = windowsInstaller(release);
  if (!stableTag.test(tag) || !download?.identity || download.version !== tag || download.identity.size > 650_000_000
    || release.html_url !== `https://github.com/${repository}/releases/tag/${tag}`
    || typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))) {
    throw new ReleaseScanError('invalid-published-release');
  }
  return download;
}

export function scanInvocation(environment, event) {
  const tag = environment.RELEASE_TAG;
  if (environment.GITHUB_REPOSITORY !== repository || !stableTag.test(tag || '')) throw new ReleaseScanError('untrusted-invocation');
  if (environment.GITHUB_EVENT_NAME === 'workflow_dispatch' && environment.GITHUB_REF === 'refs/heads/main') {
    if (environment.RECOVERY_ANALYSIS_ID && !idPattern.test(environment.RECOVERY_ANALYSIS_ID)) throw new ReleaseScanError('invalid-recovery-id');
    return { tag };
  }
  const release = event?.release;
  if (environment.GITHUB_EVENT_NAME !== 'release' || event?.action !== 'published' || environment.GITHUB_REF !== `refs/tags/${tag}`
    || release?.draft !== false || release?.prerelease !== false || release?.tag_name !== tag
    || !Number.isSafeInteger(release?.id) || release.id <= 0) throw new ReleaseScanError('untrusted-invocation');
  return { tag, expectedReleaseId: release.id };
}

export async function releaseScanPlan({ api, tag, expectedReleaseId, isAncestor }) {
  if (!stableTag.test(tag || '')) throw new ReleaseScanError('invalid-tag');
  const release = await api('GET', `/releases/tags/${tag}`);
  const download = publishedInstaller(release, tag);
  if (expectedReleaseId !== undefined && release.id !== expectedReleaseId) throw new ReleaseScanError('release-id-changed');
  const commit = (await api('GET', `/commits/${tag}`))?.sha;
  if (!sha.test(commit || '') || !await isAncestor(commit)) throw new ReleaseScanError('untrusted-tag-commit');
  return { tag, releaseId: release.id, commit, download };
}

async function currentRelease(api, plan) {
  const release = await api('GET', `/releases/${plan.releaseId}`);
  const download = publishedInstaller(release, plan.tag);
  const commit = (await api('GET', `/commits/${plan.tag}`))?.sha;
  if (release.id !== plan.releaseId || commit !== plan.commit || !sameIdentity(download.identity, plan.download.identity)) {
    throw new ReleaseScanError('release-changed');
  }
  return release;
}

function storedScan(release, download) {
  const value = scanFromNotes(release.body, download);
  if (!value && typeof release.body === 'string' && (release.body.includes(scanNotesStart) || release.body.includes(scanNotesEnd))) {
    throw new ReleaseScanError('invalid-stored-scan');
  }
  return value;
}

/** Only the release body is patched. Prose edits detected before writing are merged. */
async function saveState(api, plan, value, previous, now) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const release = await currentRelease(api, plan);
    const existing = storedScan(release, plan.download);
    if (JSON.stringify(existing) !== JSON.stringify(previous)) throw new ReleaseScanError('scan-changed-concurrently');
    const updatedAt = new Date(Math.max(now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString();
    const state = installerScan({ schemaVersion: 1, installer: plan.download.identity, ...value, updatedAt }, plan.download);
    if (!state) throw new ReleaseScanError('invalid-scan-state');
    const body = notesWithScan(release.body || '', state, plan.download);
    const fresh = await currentRelease(api, plan);
    if (fresh.body !== release.body) continue;
    if (body === fresh.body) return state;
    const saved = await api('PATCH', `/releases/${plan.releaseId}`, { body });
    if (saved.body !== body || saved.id !== plan.releaseId || !sameIdentity(publishedInstaller(saved, plan.tag).identity, plan.download.identity)) {
      throw new ReleaseScanError('state-write-not-confirmed');
    }
    return state;
  }
  throw new ReleaseScanError('notes-changed-concurrently');
}

export async function downloadReleaseInstaller(download, directory, { fetchImpl = fetch } = {}) {
  const identity = download?.identity;
  if (!identity || identity.size > 650_000_000 || path.basename(identity.name) !== identity.name
    || download.url !== `https://github.com/${repository}/releases/download/${identity.version}/${identity.name}`) {
    throw new ReleaseScanError('invalid-download');
  }
  const file = path.join(directory, identity.name);
  const signal = AbortSignal.timeout(300_000);
  let url = download.url;
  let temporary;
  try {
    temporary = await mkdtemp(path.join(directory, '.installer-download-'));
    let response;
    for (let redirect = 0; redirect <= 3; redirect++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
        || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) {
        throw new ReleaseScanError('untrusted-download-redirect');
      }
      response = await fetchImpl(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirect === 3) throw new ReleaseScanError('invalid-download-redirect');
      url = new URL(location, url).href;
    }
    const length = response.headers.get('content-length');
    if (response.status !== 200 || !response.body || length !== null && Number(length) !== identity.size) {
      throw new ReleaseScanError('invalid-download-response');
    }
    let size = 0;
    const hash = createHash('sha256');
    const verify = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > identity.size) return callback(new ReleaseScanError('download-size-mismatch'));
      hash.update(chunk);
      callback(null, chunk);
    } });
    const partial = path.join(temporary, 'payload');
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal });
    if (size !== identity.size || hash.digest('hex') !== identity.sha256) throw new ReleaseScanError('download-hash-mismatch');
    await link(partial, file);
    return file;
  } catch (error) {
    if (error instanceof ReleaseScanError) throw error;
    throw new ReleaseScanError('download-failed');
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}

/** Called only after the API has verified the completed analysis's file identity. */
export async function publicReportAvailable(download, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`https://www.virustotal.com/gui/file/${download.identity.sha256}`, {
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    const available = response.status === 200 && /^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '');
    await response.body?.cancel();
    return available;
  } catch { return false; }
}

export async function scanPublishedRelease({ api, plan, virusTotal, directory, now = Date.now,
  download = downloadReleaseInstaller, verifyReport = publicReportAvailable, backupReceipt = async () => {}, recoveryAnalysisId }) {
  let stored = storedScan(await currentRelease(api, plan), plan.download);
  if (stored?.state === 'completed') {
    if (recoveryAnalysisId && stored.submission?.analysisId !== recoveryAnalysisId) throw new ReleaseScanError('completed-scan-cannot-be-replaced');
    // A temporarily unavailable GUI route may become available on a later retry.
    if (!stored.report && stored.submission?.phase === 'submitted') {
      const snapshot = await virusTotal.getAnalysis({ installer: stored.installer,
        analysisId: stored.submission.analysisId, submittedAt: stored.submission.submittedAt }, plan.download);
      if (snapshot.state === 'completed' && sameIdentity(snapshot.installer, stored.installer)
        && snapshot.analysisId === stored.submission.analysisId && await verifyReport(plan.download)) {
        await saveState(api, plan, { ...stored, report: {
          url: `https://www.virustotal.com/gui/file/${stored.installer.sha256}`, verifiedAt: new Date(now()).toISOString(),
        } }, stored, now);
      }
    }
    return { state: 'completed', reused: true };
  }
  let receipt;
  let submission = stored?.submission;
  let uploadIntent = false;
  const persist = async value => { stored = await saveState(api, plan, value, stored, now); };
  try {
    if (recoveryAnalysisId) {
      if (!idPattern.test(recoveryAnalysisId)) throw new ReleaseScanError('invalid-recovery-id');
      receipt = { analysisId: recoveryAnalysisId, installer: plan.download.identity,
        submittedAt: submission?.phase === 'submitted' ? submission.submittedAt : new Date(now()).toISOString() };
    } else if (submission?.phase === 'submitted') {
      receipt = { analysisId: submission.analysisId, installer: plan.download.identity, submittedAt: submission.submittedAt };
    } else if (submission) {
      throw new ReleaseScanError('submission-recovery-required');
    } else {
      const file = await download(plan.download, directory);
      submission = { phase: 'uploading', startedAt: new Date(now()).toISOString() };
      await persist({ state: 'pending', submission });
      // The intent is durable before POST; a lost acknowledgement can never cause an automatic resubmission.
      await currentRelease(api, plan);
      uploadIntent = true;
      receipt = await virusTotal.submitInstaller(file, plan.download);
    }
    if (!sameIdentity(receipt?.installer, plan.download.identity)) throw new ReleaseScanError('invalid-receipt');
    submission = { phase: 'submitted', startedAt: submission?.startedAt || receipt.submittedAt,
      submittedAt: receipt.submittedAt, analysisId: receipt.analysisId };
    const checkpoint = installerScan({ schemaVersion: 1, installer: plan.download.identity, updatedAt: new Date(now()).toISOString(),
      state: 'queued', submission }, plan.download);
    if (!checkpoint) throw new ReleaseScanError('invalid-receipt');
    // Both copies contain only explicitly selected fields, never a raw provider response.
    try { await backupReceipt({ schemaVersion: 1, installer: checkpoint.installer, ...checkpoint.submission }); } catch { /* The release copy remains the primary checkpoint. */ }
    if (JSON.stringify(stored?.submission) !== JSON.stringify(submission) || !['queued', 'in-progress'].includes(stored?.state)) {
      await persist({ state: 'queued', submission });
    }
    const result = await virusTotal.waitForAnalysis(receipt, plan.download, { onUpdate: async snapshot => {
      if (!sameIdentity(snapshot.installer, plan.download.identity) || snapshot.analysisId !== receipt.analysisId
        || !['queued', 'in-progress', 'completed'].includes(snapshot.state)) throw new ReleaseScanError('invalid-analysis-snapshot');
      if (snapshot.state !== 'completed' && snapshot.state === stored.state) return;
      const value = { state: snapshot.state, submission };
      if (snapshot.state === 'completed') {
        value.analysis = snapshot.analysis;
        if (await verifyReport(plan.download)) value.report = {
          url: `https://www.virustotal.com/gui/file/${plan.download.identity.sha256}`, verifiedAt: new Date(now()).toISOString(),
        };
      }
      await persist(value);
    } });
    if (stored.state !== result.state) throw new ReleaseScanError('analysis-state-not-persisted');
    return { state: stored.state, pollingStopped: result.pollingStopped === true };
  } catch (error) {
    if (error instanceof ReleaseScanError && ['scan-changed-concurrently', 'notes-changed-concurrently', 'invalid-stored-scan'].includes(error.code)) throw error;
    // Re-read after a failed PATCH; it may have committed before the connection failed.
    try {
      stored = storedScan(await currentRelease(api, plan), plan.download);
      if (stored?.state !== 'completed') {
        const savedSubmission = stored?.submission;
        const retained = receipt && submission?.phase === 'submitted' ? submission
          : savedSubmission?.phase === 'submitted' ? savedSubmission
          : savedSubmission ? { phase: 'uncertain', startedAt: savedSubmission.startedAt } : undefined;
        const definiteRejection = !receipt && uploadIntent && error?.name === 'VirusTotalError' && error.code !== 'submission-uncertain';
        await persist({ state: 'unavailable', ...(!definiteRejection && retained ? { submission: retained } : {}) });
      }
    } catch { /* Preserve the durable intent/receipt if GitHub is unavailable or identity has changed. */ }
    throw error instanceof ReleaseScanError || error?.name === 'VirusTotalError' ? error : new ReleaseScanError('scan-operation-failed');
  }
}

export async function main(action, environment = process.env) {
  const event = JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, 'utf8'));
  const invocation = scanInvocation(environment, event);
  if (!['validate', 'scan'].includes(action)) throw new ReleaseScanError('invalid-action');
  if (!environment.GH_TOKEN) throw new ReleaseScanError('missing-github-token');
  const api = releaseApi(repository, environment.GH_TOKEN);
  const expectedReleaseId = invocation.expectedReleaseId ?? (environment.EXPECTED_RELEASE_ID ? Number(environment.EXPECTED_RELEASE_ID) : undefined);
  const plan = await releaseScanPlan({ api, tag: invocation.tag, expectedReleaseId, isAncestor: async commit => {
    try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { stdio: 'ignore' }); return true; } catch { return false; }
  } });
  if (action === 'validate') {
    const automationCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!sha.test(automationCommit)) throw new ReleaseScanError('invalid-automation-commit');
    if (environment.GITHUB_OUTPUT) await appendFile(environment.GITHUB_OUTPUT,
      `tag=${plan.tag}\nrelease_id=${plan.releaseId}\ncommit=${plan.commit}\nautomation_commit=${automationCommit}\n`);
    return;
  }
  if (!environment.EXPECTED_RELEASE_ID || plan.releaseId !== Number(environment.EXPECTED_RELEASE_ID)
    || plan.commit !== environment.EXPECTED_RELEASE_COMMIT) throw new ReleaseScanError('validation-plan-changed');
  const virusTotal = createVirusTotalClient({ apiKey: environment.VIRUSTOTAL_API_KEY });
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    && (environment.DIAGNOSE_UPLOAD_URL === 'true' || environment.DIAGNOSE_ANALYSIS === 'true')) {
    throw new ReleaseScanError('diagnostic-requires-manual-run');
  }
  if (environment.DIAGNOSE_ANALYSIS === 'true') {
    const stored = storedScan(await currentRelease(api, plan), plan.download);
    if (stored?.submission?.phase !== 'submitted') throw new ReleaseScanError('analysis-diagnosis-requires-receipt');
    const receipt = { analysisId: stored.submission.analysisId, installer: plan.download.identity, submittedAt: stored.submission.submittedAt };
    console.log(`VirusTotal analysis identity: ${JSON.stringify(await virusTotal.diagnoseAnalysis(receipt, plan.download))}`);
    return;
  }
  if (environment.DIAGNOSE_UPLOAD_URL === 'true') {
    console.log(`VirusTotal upload URL format: ${JSON.stringify(await virusTotal.diagnoseUploadUrl())}`);
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-release-scan-'));
  try {
    const result = await scanPublishedRelease({ api, plan, virusTotal, directory, recoveryAnalysisId: environment.RECOVERY_ANALYSIS_ID,
      backupReceipt: async receipt => {
        await mkdir('.ai', { recursive: true });
        await writeFile('.ai/virustotal-receipt.json', `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
      } });
    console.log(`Installer scan state: ${result.state}${result.pollingStopped ? ' (polling limit reached; resume manually)' : ''}.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => {
    const code = error instanceof ReleaseScanError || error?.name === 'VirusTotalError' ? error.code : 'unexpected-failure';
    console.error(`Release scan stopped: ${code}.`);
    process.exitCode = 1;
  });
}
