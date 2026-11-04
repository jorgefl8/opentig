import { z } from 'zod';
import type { PullRequestCheck, PullRequestCheckState, PullRequestLatestReview, PullRequestLiveState, PullRequestMergeMethod, PullRequestMergeStateStatus, PullRequestParticipant } from '../../shared/contracts';

/** `$headRef` is `refs/pull/<number>/head`, which also reaches branches of forks. */
export const PR_LIVE_STATE_QUERY = `query($owner:String!,$name:String!,$number:Int!,$headRef:String!){
  repository(owner:$owner,name:$name){
    viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    autoMergeAllowed deleteBranchOnMerge viewerDefaultMergeMethod
    pullRequest(number:$number){
      id number state isDraft headRefOid headRefName baseRefName updatedAt
      mergeable mergeStateStatus reviewDecision isCrossRepository
      isMergeQueueEnabled isInMergeQueue
      viewerCanUpdate viewerDidAuthor viewerCanUpdateBranch
      autoMergeRequest{mergeMethod}
      latestReviews(first:30){nodes{state author{__typename login avatarUrl} commit{oid}}}
      headRef{id target{oid}}
      headRepositoryOwner{login}
      headRepository{id viewerPermission defaultBranchRef{name}}
      baseRef{compare(headRef:$headRef){behindBy}}
      commits(last:1){nodes{commit{statusCheckRollup{state
        contexts(first:100){pageInfo{hasNextPage} nodes{
          __typename
          ... on CheckRun{name status conclusion detailsUrl startedAt completedAt
            isRequired(pullRequestNumber:$number)
            checkSuite{workflowRun{workflow{name}}}}
          ... on StatusContext{context state targetUrl createdAt
            isRequired(pullRequestNumber:$number)}
        }}}}}}
    }
  }
}`;

export type PullRequestLiveStateRead =
  | { status: 'ok'; state: PullRequestLiveState }
  /** GitHub answered, and the repository has no such pull request. */
  | { status: 'missing' }
  /** No usable answer; the command's exit status and stderr explain why. */
  | { status: 'unusable' };

export const participantSchema = z.object({ __typename: z.string().optional(), login: z.string(), avatarUrl: z.string().nullish() });

const checkRunSchema = z.object({
  __typename: z.literal('CheckRun'),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullish(),
  detailsUrl: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  isRequired: z.boolean().nullish(),
  checkSuite: z.object({ workflowRun: z.object({ workflow: z.object({ name: z.string() }).nullish() }).nullish() }).nullish(),
});
const statusContextSchema = z.object({
  __typename: z.literal('StatusContext'),
  context: z.string(),
  state: z.string(),
  targetUrl: z.string().nullish(),
  createdAt: z.string().nullish(),
  isRequired: z.boolean().nullish(),
});
const rollupSchema = z.object({
  state: z.string(),
  contexts: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    nodes: z.array(z.discriminatedUnion('__typename', [checkRunSchema, statusContextSchema]).nullable()).nullish(),
  }),
});
const pullRequestSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive().safe(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefOid: z.string().min(1),
  headRefName: z.string(),
  baseRefName: z.string(),
  updatedAt: z.string(),
  mergeable: z.string().nullish(),
  mergeStateStatus: z.string().nullish(),
  reviewDecision: z.string().nullish(),
  isCrossRepository: z.boolean(),
  isMergeQueueEnabled: z.boolean().nullish(),
  isInMergeQueue: z.boolean().nullish(),
  viewerCanUpdate: z.boolean(),
  viewerDidAuthor: z.boolean(),
  viewerCanUpdateBranch: z.boolean(),
  autoMergeRequest: z.object({ mergeMethod: z.string() }).nullish(),
  latestReviews: z.object({ nodes: z.array(z.object({ state: z.string(), author: participantSchema.nullish(), commit: z.object({ oid: z.string() }).nullish() }).nullable()).nullish() }).nullish(),
  headRef: z.object({ target: z.object({ oid: z.string() }).nullish() }).nullish(),
  headRepositoryOwner: z.object({ login: z.string() }).nullish(),
  headRepository: z.object({
    id: z.string(),
    viewerPermission: z.string().nullish(),
    defaultBranchRef: z.object({ name: z.string() }).nullish(),
  }).nullish(),
  baseRef: z.object({ compare: z.object({ behindBy: z.number().int().nonnegative() }).nullish() }).nullish(),
  commits: z.object({
    nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: rollupSchema.nullish() }) }).nullable()).nullish(),
  }).nullish(),
});
const responseSchema = z.object({
  data: z.object({
    repository: z.object({
      viewerPermission: z.string().nullish(),
      mergeCommitAllowed: z.boolean(),
      squashMergeAllowed: z.boolean(),
      rebaseMergeAllowed: z.boolean(),
      autoMergeAllowed: z.boolean(),
      deleteBranchOnMerge: z.boolean(),
      viewerDefaultMergeMethod: z.string().nullish(),
      pullRequest: pullRequestSchema.nullable(),
    }),
  }),
  errors: z.array(z.object({ type: z.string().nullish(), path: z.array(z.union([z.string(), z.number()])).nullish() })).optional(),
});

/**
 * `gh api graphql` exits 1 even when the response carries data, so the outcome
 * depends on the response rather than the exit status. Fields GitHub withheld
 * from this account keep the rest of the state readable and mark it partial.
 */
export function parsePullRequestLiveState(raw: string, stack: PullRequestLiveState['stack']): PullRequestLiveStateRead {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { status: 'unusable' }; }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return { status: 'unusable' };
  const { data: { repository }, errors = [] } = parsed.data;
  const pull = repository.pullRequest;
  if (!pull) return { status: errors.every(isMissingPullRequest) ? 'missing' : 'unusable' };
  if (!errors.every(isWithheldField)) return { status: 'unusable' };

  const methods = ([
    [repository.mergeCommitAllowed, 'MERGE'], [repository.squashMergeAllowed, 'SQUASH'], [repository.rebaseMergeAllowed, 'REBASE'],
  ] as const).flatMap(([allowed, method]) => allowed ? [method] : []);
  const preferred = mergeMethod(repository.viewerDefaultMergeMethod);
  const rollup = pull.commits?.nodes?.at(-1)?.commit.statusCheckRollup ?? null;
  const headRefOid = pull.headRef?.target?.oid ?? null;
  return {
    status: 'ok',
    state: {
      id: pull.id,
      number: pull.number,
      state: pull.state,
      isDraft: pull.isDraft,
      headRefOid: pull.headRefOid,
      headRefName: pull.headRefName,
      baseRefName: pull.baseRefName,
      updatedAt: pull.updatedAt,
      mergeable: pull.mergeable === 'MERGEABLE' || pull.mergeable === 'CONFLICTING' ? pull.mergeable : 'UNKNOWN',
      mergeStateStatus: mergeStateStatus(pull.mergeStateStatus),
      reviewDecision: pull.reviewDecision || null,
      latestReviews: (pull.latestReviews?.nodes ?? []).flatMap((review): PullRequestLatestReview[] => {
        if (!review?.author || (review.state !== 'APPROVED' && review.state !== 'CHANGES_REQUESTED')) return [];
        return [{ author: participant(review.author), verdict: review.state, outdated: review.commit?.oid !== pull.headRefOid }];
      }),
      isCrossRepository: pull.isCrossRepository,
      stack,
      autoMerge: pull.autoMergeRequest ? { method: mergeMethod(pull.autoMergeRequest.mergeMethod) ?? 'MERGE' } : null,
      mergeQueue: { enabled: pull.isMergeQueueEnabled === true, queued: pull.isInMergeQueue === true },
      behindBy: pull.baseRef?.compare?.behindBy ?? null,
      checks: {
        rollup: rollupState(rollup?.state),
        items: dedupeChecks(rollup?.contexts.nodes ?? []),
        truncated: rollup?.contexts.pageInfo.hasNextPage === true,
        partial: errors.length > 0,
      },
      head: {
        repositoryId: pull.headRepository?.id ?? null,
        owner: pull.headRepositoryOwner?.login ?? null,
        defaultBranch: pull.headRepository?.defaultBranchRef?.name ?? null,
        refOid: headRefOid,
      },
      repository: {
        methods,
        defaultMethod: preferred && methods.includes(preferred) ? preferred : methods[0] ?? 'MERGE',
        autoMergeAllowed: repository.autoMergeAllowed,
        deleteBranchOnMerge: repository.deleteBranchOnMerge,
      },
      viewer: {
        canWrite: canWrite(repository.viewerPermission),
        canUpdate: pull.viewerCanUpdate,
        didAuthor: pull.viewerDidAuthor,
        canUpdateBranch: pull.viewerCanUpdateBranch,
        canDeleteBranch: canWrite(pull.headRepository?.viewerPermission) && pull.headRef != null,
      },
    },
  };
}

type ResponseError = NonNullable<z.infer<typeof responseSchema>['errors']>[number];

function isMissingPullRequest(error: ResponseError): boolean {
  return error.type === 'NOT_FOUND' && error.path?.length === 2 && error.path[0] === 'repository' && error.path[1] === 'pullRequest';
}

export function participant(author: z.infer<typeof participantSchema>): PullRequestParticipant {
  return { login: author.login, avatarUrl: author.avatarUrl || null, isBot: author.__typename === 'Bot' };
}

export function isWithheldField(error: ResponseError): boolean {
  return (error.type === 'FORBIDDEN' || error.type === 'NOT_FOUND')
    && (error.path?.length ?? 0) > 2 && error.path?.[0] === 'repository' && error.path[1] === 'pullRequest';
}

function canWrite(permission: string | null | undefined): boolean {
  return permission === 'ADMIN' || permission === 'MAINTAIN' || permission === 'WRITE';
}

function mergeMethod(value: string | null | undefined): PullRequestMergeMethod | null {
  return value === 'MERGE' || value === 'SQUASH' || value === 'REBASE' ? value : null;
}

const MERGE_STATE_STATUSES: ReadonlySet<string> = new Set<PullRequestMergeStateStatus>(['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE']);

function mergeStateStatus(value: string | null | undefined): PullRequestMergeStateStatus {
  return value && MERGE_STATE_STATUSES.has(value) ? value as PullRequestMergeStateStatus : 'UNKNOWN';
}

function rollupState(value: string | undefined): PullRequestCheckState {
  if (value === undefined) return 'NONE';
  if (value === 'SUCCESS') return 'PASSING';
  return value === 'FAILURE' || value === 'ERROR' ? 'FAILING' : 'PENDING';
}

type CheckNode = z.infer<typeof checkRunSchema> | z.infer<typeof statusContextSchema>;

function checkResult(node: CheckNode): PullRequestCheck['result'] {
  if (node.__typename === 'StatusContext') {
    if (node.state === 'SUCCESS') return 'pass';
    return node.state === 'FAILURE' || node.state === 'ERROR' ? 'fail' : 'pending';
  }
  if (node.status !== 'COMPLETED') return 'pending';
  switch (node.conclusion) {
    case 'SUCCESS': return 'pass';
    case 'NEUTRAL': case 'SKIPPED': return 'skipped';
    case 'ACTION_REQUIRED': return 'action-required';
    case 'FAILURE': case 'TIMED_OUT': case 'CANCELLED': case 'STARTUP_FAILURE': return 'fail';
    default: return 'pending';
  }
}

/** Reruns and overlapping runs repeat a check without an id: the newest run of a workflow and name represents it. */
function dedupeChecks(nodes: Array<CheckNode | null>): PullRequestCheck[] {
  const newest = new Map<string, { check: PullRequestCheck; at: number }>();
  for (const node of nodes) {
    if (!node) continue;
    const name = node.__typename === 'CheckRun' ? node.name : node.context;
    const workflow = node.__typename === 'CheckRun' ? node.checkSuite?.workflowRun?.workflow?.name ?? null : null;
    const url = (node.__typename === 'CheckRun' ? node.detailsUrl : node.targetUrl) || null;
    const result = checkResult(node);
    const stamp = node.__typename === 'CheckRun' ? node.completedAt || node.startedAt : node.createdAt;
    const at = result === 'pending' ? Number.POSITIVE_INFINITY : Date.parse(stamp ?? '') || Number.NEGATIVE_INFINITY;
    const key = JSON.stringify([workflow, name]);
    const kept = newest.get(key);
    if (!kept || at >= kept.at) newest.set(key, { check: { name, workflow, result, required: node.isRequired === true, url }, at });
  }
  return [...newest.values()].map(({ check }) => check);
}
