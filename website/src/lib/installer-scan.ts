import type { InstallerIdentity, WindowsDownload } from './downloads';

const statisticNames = [
  'malicious', 'suspicious', 'harmless', 'undetected',
  'timeout', 'confirmed-timeout', 'failure', 'type-unsupported',
] as const;

export type ScanStatistics = Record<typeof statisticNames[number], number>;
type PublicReport = { url: string; verifiedAt: string };
export type ScanSubmission =
  | { phase: 'uploading' | 'uncertain'; startedAt: string }
  | { phase: 'submitted'; startedAt: string; submittedAt: string; analysisId: string };
type ScanBase = { schemaVersion: 1; installer: InstallerIdentity; updatedAt: string; submission?: ScanSubmission };
export type InstallerScan = ScanBase & (
  | { state: 'pending' | 'unavailable' }
  | { state: 'queued' | 'in-progress'; report?: PublicReport }
  | { state: 'completed'; report?: PublicReport; analysis: { analysisAt: string; statistics: ScanStatistics } }
);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

// Canonical UTC timestamps keep comparisons unambiguous across producers/readers.
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Validates metadata only. The producer must verify public report availability. */
export function installerScan(value: unknown, download: WindowsDownload): InstallerScan | undefined {
  const expected = download.identity;
  if (!expected || !record(value) || value.schemaVersion !== 1 || !record(value.installer)
    || !timestamp(value.updatedAt)) return;
  const installer = value.installer;
  const identityKeys = ['repository', 'version', 'releaseId', 'assetId', 'name', 'size', 'sha256'] as const;
  if (!onlyKeys(installer, identityKeys)
    || !identityKeys.every(key => installer[key] === expected[key])
    || expected.version !== download.version
    || download.url !== `https://github.com/jorgefl8/opentig/releases/download/${expected.version}/${expected.name}`) return;

  const base: ScanBase = { schemaVersion: 1, installer: { ...expected }, updatedAt: value.updatedAt };
  const baseKeys = ['schemaVersion', 'installer', 'updatedAt', 'state', 'submission'];
  if ('submission' in value) {
    const submission = value.submission;
    if (!record(submission) || !timestamp(submission.startedAt) || submission.startedAt > value.updatedAt) return;
    if (submission.phase === 'submitted') {
      if (!onlyKeys(submission, ['phase', 'startedAt', 'submittedAt', 'analysisId'])
        || !timestamp(submission.submittedAt) || submission.submittedAt < submission.startedAt
        || submission.submittedAt > value.updatedAt || typeof submission.analysisId !== 'string'
        || !/^[A-Za-z0-9_+=/-]{1,512}$/.test(submission.analysisId) || value.state === 'pending') return;
      base.submission = { phase: 'submitted', startedAt: submission.startedAt, submittedAt: submission.submittedAt, analysisId: submission.analysisId };
    } else if (submission.phase === 'uploading' || submission.phase === 'uncertain') {
      if (!onlyKeys(submission, ['phase', 'startedAt'])
        || (value.state !== 'pending' && value.state !== 'unavailable')
        || (submission.phase === 'uncertain' && value.state !== 'unavailable')) return;
      base.submission = { phase: submission.phase, startedAt: submission.startedAt };
    } else return;
  }
  if (value.state === 'pending' || value.state === 'unavailable') {
    return onlyKeys(value, baseKeys) ? { ...base, state: value.state } : undefined;
  }
  if (value.state !== 'queued' && value.state !== 'in-progress' && value.state !== 'completed') return;
  if (!onlyKeys(value, [...baseKeys, 'report', ...(value.state === 'completed' ? ['analysis'] : [])])) return;

  let report: PublicReport | undefined;
  if ('report' in value) {
    if (!record(value.report) || !onlyKeys(value.report, ['url', 'verifiedAt'])
      || value.report.url !== `https://www.virustotal.com/gui/file/${expected.sha256}`
      || !timestamp(value.report.verifiedAt) || value.report.verifiedAt > value.updatedAt) return;
    report = { url: value.report.url, verifiedAt: value.report.verifiedAt };
  }
  const reported = report ? { report } : {};
  if (value.state !== 'completed') return { ...base, state: value.state, ...reported };

  if (!record(value.analysis) || !onlyKeys(value.analysis, ['analysisAt', 'statistics'])
    || !timestamp(value.analysis.analysisAt) || value.analysis.analysisAt > value.updatedAt
    || !record(value.analysis.statistics) || !onlyKeys(value.analysis.statistics, statisticNames)) return;
  const statistics = {} as ScanStatistics;
  for (const name of statisticNames) {
    const count = value.analysis.statistics[name];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return;
    statistics[name] = count;
  }
  const total = Object.values(statistics).reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(total) || total === 0) return;
  return { ...base, state: 'completed', ...reported, analysis: { analysisAt: value.analysis.analysisAt, statistics } };
}
