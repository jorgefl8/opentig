import type { PullRequestCheckState, PullRequestCommit, PullRequestDetails, PullRequestLabel, PullRequestState, PullRequestSummary } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';
import { z } from 'zod';

export const PR_SUMMARY_FIELDS = 'number,title,state,isDraft,author,headRefName,baseRefName,updatedAt,url,reviewDecision,additions,deletions,statusCheckRollup';
export const PR_DETAIL_FIELDS = `${PR_SUMMARY_FIELDS},body,changedFiles,labels,commits`;

const tolerantRecordSchema = z.looseObject({});
const pullRequestArraySchema = z.array(z.unknown());
const summaryRecordSchema = z.looseObject({
  number: z.number().safe().int().positive(),
  state: z.string().transform((value) => value.toUpperCase()).pipe(z.enum(['OPEN', 'CLOSED', 'MERGED'])),
});

export function parsePullRequestList(raw: string): PullRequestSummary[] {
  const parsed: unknown = parseJson(raw, 'gh-pr-list');
  const list = pullRequestArraySchema.safeParse(parsed);
  if (!list.success) throw invalidOutput('gh-pr-list');
  return list.data.map((item) => parseSummary(item, 'gh-pr-list'));
}

export function parsePullRequestDetails(raw: string): PullRequestDetails {
  const item: unknown = parseJson(raw, 'gh-pr-view');
  const summary = parseSummary(item, 'gh-pr-view');
  const record = item as Record<string, unknown>;
  return {
    ...summary,
    body: typeof record.body === 'string' ? record.body : '',
    changedFiles: numberOrZero(record.changedFiles),
    labels: parseLabels(record.labels),
    commits: parseCommits(record.commits),
  };
}

export function sortPullRequestsNewestFirst(pulls: PullRequestSummary[]): PullRequestSummary[] {
  return [...pulls].sort((left, right) => {
    const leftTimestamp = validTimestamp(left.updatedAt);
    const rightTimestamp = validTimestamp(right.updatedAt);
    return rightTimestamp - leftTimestamp || right.number - left.number;
  });
}

export function selectPullRequestsNewestFirst(pulls: PullRequestSummary[], states: PullRequestState[]): PullRequestSummary[] {
  const selectedStates = new Set(states);
  const unique = new Map<number, PullRequestSummary>();
  for (const pull of pulls) {
    if (selectedStates.has(pull.state)) unique.set(pull.number, pull);
  }
  return sortPullRequestsNewestFirst([...unique.values()]);
}

/** `gh pr create` prints the new PR URL on stdout upon success. */
export function parseCreatedPullRequestUrl(stdout: string): { url: string; number: number | null } | null {
  const match = /https:\/\/github\.com\/[^\s"']+\/pull\/(\d+)/.exec(stdout);
  if (!match) return null;
  const parsedNumber = Number(match[1]);
  return { url: match[0], number: Number.isSafeInteger(parsedNumber) ? parsedNumber : null };
}

function parseSummary(item: unknown, operation: string): PullRequestSummary {
  const parsed = summaryRecordSchema.safeParse(item);
  if (!parsed.success) throw invalidOutput(operation);
  const record = parsed.data;
  const { number, state } = parsed.data;
  const parsedAuthor = tolerantRecordSchema.safeParse(record.author);
  const authorRecord = parsedAuthor.success ? parsedAuthor.data : null;
  const author = authorRecord?.login;
  const authorLogin = typeof author === 'string' ? author : 'unknown';
  return {
    number,
    title: typeof record.title === 'string' ? record.title : '',
    state: state as PullRequestState,
    isDraft: record.isDraft === true,
    author: authorLogin,
    authorAvatarUrl: avatarUrl(authorLogin, authorRecord?.is_bot === true),
    headRefName: typeof record.headRefName === 'string' ? record.headRefName : '',
    baseRefName: typeof record.baseRefName === 'string' ? record.baseRefName : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    url: typeof record.url === 'string' ? record.url : '',
    reviewDecision: typeof record.reviewDecision === 'string' && record.reviewDecision ? record.reviewDecision : null,
    additions: numberOrZero(record.additions),
    deletions: numberOrZero(record.deletions),
    checksState: parseChecksState(record.statusCheckRollup),
  };
}

function parseLabels(value: unknown): PullRequestLabel[] {
  const parsed = pullRequestArraySchema.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.flatMap((item) => {
    const candidate = tolerantRecordSchema.safeParse(item);
    if (!candidate.success) return [];
    const record = candidate.data;
    if (typeof record.name !== 'string' || !record.name) return [];
    const color = typeof record.color === 'string' && /^[0-9a-f]{6}$/i.test(record.color) ? record.color : '6e7781';
    return [{ name: record.name, color }];
  });
}

function parseCommits(value: unknown): PullRequestCommit[] {
  const parsed = pullRequestArraySchema.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.flatMap((item) => {
    const candidate = tolerantRecordSchema.safeParse(item);
    if (!candidate.success) return [];
    const record = candidate.data;
    if (typeof record.oid !== 'string' || !record.oid) return [];
    const authors = Array.isArray(record.authors) ? record.authors : [];
    const authorRecord = authors.map((author) => tolerantRecordSchema.safeParse(author)).find((author) => author.success)?.data;
    const login = typeof authorRecord?.login === 'string' ? authorRecord.login : null;
    const name = typeof authorRecord?.name === 'string' && authorRecord.name ? authorRecord.name : login ?? 'unknown';
    return [{
      oid: record.oid,
      messageHeadline: typeof record.messageHeadline === 'string' ? record.messageHeadline : '',
      authoredAt: typeof record.authoredDate === 'string' ? record.authoredDate : '',
      author: name,
      authorAvatarUrl: login ? avatarUrl(login, login.endsWith('[bot]')) : null,
    }];
  });
}

function parseChecksState(value: unknown): PullRequestCheckState {
  if (!Array.isArray(value) || value.length === 0) return 'NONE';
  let pending = false;
  for (const item of value) {
    const parsed = tolerantRecordSchema.safeParse(item);
    if (!parsed.success) continue;
    const record = parsed.data;
    const conclusion = typeof record.conclusion === 'string' ? record.conclusion.toUpperCase() : '';
    const state = typeof record.state === 'string' ? record.state.toUpperCase() : '';
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion || state)) return 'FAILING';
    const status = typeof record.status === 'string' ? record.status.toUpperCase() : '';
    if ((status && status !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(state)) pending = true;
  }
  return pending ? 'PENDING' : 'PASSING';
}

function avatarUrl(login: string, isBot: boolean): string | null {
  if (!login || login === 'unknown') return null;
  if (login === 'app/dependabot' || login === 'dependabot[bot]') return 'https://avatars.githubusercontent.com/in/29110?s=40&v=4';
  const botName = login.startsWith('app/') ? login.slice(4) : login.replace(/\[bot\]$/i, '');
  const path = isBot || login.startsWith('app/') ? botName : login;
  return `https://github.com/${encodeURIComponent(path)}.png?size=40`;
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

function validTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function invalidOutput(operation: string): GhOperationError {
  return new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
}
