import type { PullRequestDetails, PullRequestState, PullRequestSummary } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';

export const PR_SUMMARY_FIELDS = 'number,title,state,isDraft,author,headRefName,baseRefName,updatedAt,url,reviewDecision';
export const PR_DETAIL_FIELDS = `${PR_SUMMARY_FIELDS},body,additions,deletions,changedFiles`;

export function parsePullRequestList(raw: string): PullRequestSummary[] {
  const parsed: unknown = parseJson(raw, 'gh-pr-list');
  if (!Array.isArray(parsed)) throw invalidOutput('gh-pr-list');
  return parsed.map((item) => parseSummary(item, 'gh-pr-list'));
}

export function parsePullRequestDetails(raw: string): PullRequestDetails {
  const item: unknown = parseJson(raw, 'gh-pr-view');
  const summary = parseSummary(item, 'gh-pr-view');
  const record = item as Record<string, unknown>;
  return {
    ...summary,
    body: typeof record.body === 'string' ? record.body : '',
    additions: numberOrZero(record.additions),
    deletions: numberOrZero(record.deletions),
    changedFiles: numberOrZero(record.changedFiles),
  };
}

/** `gh pr create` prints the new PR URL on stdout upon success. */
export function parseCreatedPullRequestUrl(stdout: string): { url: string; number: number | null } | null {
  const match = /https:\/\/github\.com\/[^\s"']+\/pull\/(\d+)/.exec(stdout);
  if (!match) return null;
  const parsedNumber = Number(match[1]);
  return { url: match[0], number: Number.isSafeInteger(parsedNumber) ? parsedNumber : null };
}

function parseSummary(item: unknown, operation: string): PullRequestSummary {
  if (!item || typeof item !== 'object') throw invalidOutput(operation);
  const record = item as Record<string, unknown>;
  const number = record.number;
  const state = typeof record.state === 'string' ? record.state.toUpperCase() : '';
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw invalidOutput(operation);
  if (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED') throw invalidOutput(operation);
  const author = record.author && typeof record.author === 'object' ? (record.author as { login?: unknown }).login : undefined;
  return {
    number,
    title: typeof record.title === 'string' ? record.title : '',
    state: state as PullRequestState,
    isDraft: record.isDraft === true,
    author: typeof author === 'string' ? author : 'unknown',
    headRefName: typeof record.headRefName === 'string' ? record.headRefName : '',
    baseRefName: typeof record.baseRefName === 'string' ? record.baseRefName : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    url: typeof record.url === 'string' ? record.url : '',
    reviewDecision: typeof record.reviewDecision === 'string' && record.reviewDecision ? record.reviewDecision : null,
  };
}

function parseJson(raw: string, operation: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw invalidOutput(operation);
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function invalidOutput(operation: string): GhOperationError {
  return new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
}
