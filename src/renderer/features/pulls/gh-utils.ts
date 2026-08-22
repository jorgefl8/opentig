import type { PullRequestSummary } from '../../../shared/contracts';
import type { SerializedGhError } from '../../../shared/errors';

export function ghDetail(reason: unknown): SerializedGhError | null {
  if (!(reason instanceof Error) || !('detail' in reason) || !reason.detail || typeof reason.detail !== 'object') return null;
  const detail = reason.detail as Partial<SerializedGhError>;
  return typeof detail.code === 'string' && detail.code.startsWith('GH_') && typeof detail.message === 'string' ? detail as SerializedGhError : null;
}

export function ghErrorTitle(detail: SerializedGhError | null): string {
  if (!detail) return 'GitHub operation failed';
  if (detail.code === 'GH_CLI_NOT_FOUND') return 'GitHub CLI is not installed';
  if (detail.code === 'GH_AUTH_REQUIRED') return 'Sign in to GitHub CLI';
  if (detail.code === 'GH_NOT_GITHUB_REPO') return 'Not a GitHub repository';
  if (detail.code === 'GH_NO_UPSTREAM') return 'Publish the branch first';
  if (detail.code === 'GH_RATE_LIMITED') return 'GitHub rate limit reached';
  if (detail.code === 'GH_TIMEOUT') return 'GitHub CLI took too long';
  if (detail.code === 'GH_INVALID_OUTPUT') return 'Unexpected GitHub CLI response';
  return 'GitHub operation failed';
}

export function prStateLabel(pr: Pick<PullRequestSummary, 'state' | 'isDraft'>): string {
  if (pr.state === 'OPEN') return pr.isDraft ? 'Draft' : 'Open';
  return pr.state === 'MERGED' ? 'Merged' : 'Closed';
}

export function reviewDecisionLabel(decision: string | null): string | null {
  if (!decision) return null;
  if (decision === 'APPROVED') return 'Approved';
  if (decision === 'CHANGES_REQUESTED') return 'Changes requested';
  if (decision === 'REVIEW_REQUIRED') return 'Review required';
  return null;
}

export function openOnGitHub(url: string): void {
  void window.opentig.shell.openExternal(url).catch(() => undefined);
}
