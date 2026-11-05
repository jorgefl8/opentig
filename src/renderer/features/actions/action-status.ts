import type { ActionRunJob, ActionRunSummary } from '../../../shared/contracts';

/** How a run, job or step stands, from GitHub's status and conclusion. */
export type ActionTone = 'success' | 'failure' | 'running' | 'queued' | 'cancelled' | 'skipped' | 'neutral';

export function actionTone(status: string, conclusion: string | null): ActionTone {
  if (status !== 'completed') return status === 'in_progress' ? 'running' : 'queued';
  switch (conclusion) {
    case 'success': return 'success';
    case 'failure': case 'timed_out': case 'startup_failure': case 'action_required': return 'failure';
    case 'cancelled': return 'cancelled';
    case 'skipped': return 'skipped';
    default: return 'neutral';
  }
}

const STATUS_LABELS: Record<string, string> = { queued: 'Queued', waiting: 'Waiting', pending: 'Pending', requested: 'Requested', in_progress: 'In progress' };
const CONCLUSION_LABELS: Record<string, string> = {
  success: 'Succeeded', failure: 'Failed', timed_out: 'Timed out', startup_failure: 'Failed to start', action_required: 'Action required',
  cancelled: 'Cancelled', skipped: 'Skipped', neutral: 'Neutral', stale: 'Stale',
};

export function actionStatusLabel(status: string, conclusion: string | null): string {
  if (status !== 'completed') return STATUS_LABELS[status] ?? 'In progress';
  return (conclusion && CONCLUSION_LABELS[conclusion]) ?? 'Completed';
}

/** Several jobs as one: a failure shows first, then work still going, then whether all were skipped. */
export function combinedTone(tones: ActionTone[]): ActionTone {
  if (tones.length === 0) return 'queued';
  for (const tone of ['failure', 'running', 'queued', 'cancelled'] as const) if (tones.includes(tone)) return tone;
  if (tones.every((tone) => tone === 'skipped')) return 'skipped';
  return tones.includes('success') ? 'success' : 'neutral';
}

export function isActive(run: Pick<ActionRunSummary, 'status'>): boolean {
  return run.status !== 'completed';
}

/** "45s", "3m 05s", "1h 02m". */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** From start to end, or to now while it runs; null before it starts. */
export function elapsed(startedAt: string | null, completedAt: string | null, now: number): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

export function runDuration(run: Pick<ActionRunSummary, 'status' | 'startedAt' | 'createdAt' | 'updatedAt'>, now: number): number | null {
  return elapsed(run.startedAt ?? run.createdAt, run.status === 'completed' ? run.updatedAt : null, now);
}

const EVENT_LABELS: Record<string, string> = {
  push: 'Push', pull_request: 'Pull request', pull_request_target: 'Pull request', workflow_dispatch: 'Manual', schedule: 'Schedule',
  release: 'Release', workflow_run: 'After another workflow', workflow_call: 'Called', merge_group: 'Merge queue', repository_dispatch: 'Repository dispatch',
};

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event.replace(/_/g, ' ');
}

/** "Running · 3 of 12 jobs done", "Failed · 2 jobs failed", or the run's own state. */
export function runSentence(status: string, conclusion: string | null, jobs: ActionRunJob[]): string {
  const label = actionStatusLabel(status, conclusion);
  if (jobs.length === 0) return label;
  const tones = jobs.map((job) => actionTone(job.status, job.conclusion));
  const failed = tones.filter((tone) => tone === 'failure').length;
  if (status !== 'completed') {
    const done = jobs.filter((job) => job.status === 'completed').length;
    return `${label} · ${done} of ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} done${failed ? ` · ${failed} failed` : ''}`;
  }
  if (failed) return `${label} · ${failed} ${failed === 1 ? 'job' : 'jobs'} failed`;
  return `${label} · ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`;
}

/** A matrix job's own part of its name: "validate (linux)" under "validate" is "linux". */
export function jobLabel(jobName: string, nodeName: string): string {
  if (jobName.startsWith(`${nodeName} (`) && jobName.endsWith(')')) return jobName.slice(nodeName.length + 2, -1);
  if (jobName.startsWith(`${nodeName} / `)) return jobName.slice(nodeName.length + 3);
  return jobName;
}
