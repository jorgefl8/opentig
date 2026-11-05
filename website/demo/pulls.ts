import type { CommentOnPullRequestInput, DeletePullRequestEntryInput, DiffResult, EditPullRequestEntryInput, PullRequestActionInput, PullRequestActionResult, PullRequestCheck, PullRequestCheckState, PullRequestConversationEntry, PullRequestDetails, PullRequestLiveState, PullRequestParticipant, PullRequestStack, PullRequestStackMembership, PullRequestState, ReviewPullRequestInput, UpdatePullRequestInput } from '../../src/shared/contracts';
import { counts, initialFiles, modifiedFilter, patch, sampleDate } from './model.ts';

type Change = { path: string; before: string; after: string };
type Sample = { details: PullRequestDetails; live: PullRequestLiveState; changes: Change[][] };
type SampleStatus = {
  draft?: boolean;
  mergeable?: PullRequestLiveState['mergeable'];
  mergeState?: PullRequestLiveState['mergeStateStatus'];
  review?: string;
  behindBy?: number;
  checks?: PullRequestCheck[];
  /** Base branch, when the PR is a layer stacked on another one. */
  base?: string;
};
const filter = 'src/filter-tasks.js';
const tests = 'test/filter-tasks.test.js';
const html = initialFiles['index.html']!;
const person = (login: string, isBot = false): PullRequestParticipant => ({ login, avatarUrl: null, isBot });
const maya = person('maya-reviews');
const leo = person('leo-builds');
const bot = person('release-bot', true);
const comment = (id: string, author: PullRequestParticipant, body: string): PullRequestConversationEntry => ({ id, kind: 'comment', author, body, createdAt: sampleDate, url: null, verdict: null, minimized: false, updatedAt: sampleDate, edited: false, canEdit: false, canDelete: false });
const review = (id: string, author: PullRequestParticipant, verdict: NonNullable<PullRequestConversationEntry['verdict']>, body = ''): PullRequestConversationEntry => ({ id, kind: 'review', author, body, createdAt: sampleDate, url: null, verdict, minimized: false, updatedAt: sampleDate, edited: false, canEdit: false, canDelete: false });
const conversations: Record<number, PullRequestConversationEntry[]> = {
  21: [
    comment('c1', bot, 'All sample checks passed on this commit. The board preview is built once this is merged.'),
    review('r1', maya, 'APPROVED', 'Reads well. Completed tasks staying hidden by default is what we discussed.'),
  ],
  24: [
    comment('c2', leo, 'The `test` job fails on the empty list. Could you check `filterTasks` with no tasks?'),
    review('r2', maya, 'APPROVED'),
  ],
  25: [comment('c3', leo, 'Should unassigned tasks get their own group, or go at the end?')],
};
const check = (name: string, result: PullRequestCheck['result'], required = false): PullRequestCheck => ({ name, workflow: 'CI', result, required, url: null });
const passing = [check('test', 'pass', true), check('lint', 'pass'), check('preview', 'skipped')];
function rollup(checks: PullRequestCheck[]): PullRequestCheckState {
  if (!checks.length) return 'NONE';
  if (checks.some(c => c.result === 'fail' || c.result === 'action-required')) return 'FAILING';
  return checks.some(c => c.result === 'pending') ? 'PENDING' : 'PASSING';
}
function sample(number: number, title: string, state: PullRequestState, branch: string, body: string, commits: Array<{ title: string; changes: Change[] }>, status: SampleStatus = {}): Sample {
  const { draft = false, checks = passing } = status;
  const reviewDecision = status.review ?? (state === 'MERGED' ? 'APPROVED' : null);
  const totals = commits.flatMap(c => c.changes).reduce((sum, c) => {
    const count = counts(c.before, c.after);
    return { additions: sum.additions + count.additions, deletions: sum.deletions + count.deletions };
  }, { additions: 0, deletions: 0 });
  const oids = commits.map((_, i) => `${number.toString(16).padStart(6, '0')}${i}`.padEnd(40, 'b'));
  return {
    details: {
      number, title, state, isDraft: draft, author: 'OpenTig Demo', authorAvatarUrl: null,
      headRefName: branch, baseRefName: status.base ?? 'main', updatedAt: sampleDate,
      // Sample PRs have no corresponding GitHub URL.
      url: '', reviewDecision,
      ...totals, checksState: rollup(checks), body,
      changedFiles: new Set(commits.flatMap(c => c.changes.map(f => f.path))).size,
      labels: [{ name: branch.startsWith('docs/') ? 'documentation' : 'enhancement', color: '818cf8' }],
      commits: commits.map((c, i) => ({ oid: oids[i]!, messageHeadline: c.title, authoredAt: sampleDate, author: 'OpenTig Demo', authorAvatarUrl: null })),
      baseRefOid: 'a'.repeat(40), headRefOid: oids.at(-1) ?? '',
    },
    live: {
      id: `demo-pr-${number}`, number, state, isDraft: draft, headRefOid: oids.at(-1) ?? '', headRefName: branch, baseRefName: status.base ?? 'main', updatedAt: sampleDate,
      // GitHub stops computing mergeability once a PR is finished.
      mergeable: state === 'OPEN' ? status.mergeable ?? 'MERGEABLE' : 'UNKNOWN',
      mergeStateStatus: state === 'OPEN' ? status.mergeState ?? (draft ? 'DRAFT' : 'CLEAN') : 'UNKNOWN',
      reviewDecision, latestReviews: reviewDecision === 'APPROVED' ? [{ author: maya, verdict: 'APPROVED', outdated: state === 'OPEN' }] : [], isCrossRepository: false, stack: 'none', autoMerge: null,
      mergeQueue: { enabled: false, queued: false }, behindBy: status.behindBy ?? 0,
      checks: { rollup: rollup(checks), items: checks, truncated: false, partial: false },
      head: { repositoryId: 'demo-repository', owner: 'demo', defaultBranch: 'main', refOid: oids.at(-1) ?? null },
      repository: { methods: ['MERGE', 'SQUASH', 'REBASE'], defaultMethod: 'SQUASH', autoMergeAllowed: true, deleteBranchOnMerge: false },
      viewer: { canWrite: true, canUpdate: true, didAuthor: false, canUpdateBranch: true, canDeleteBranch: true },
    },
    changes: commits.map(c => c.changes),
  };
}
const readme = initialFiles['README.md']!;
const samples = [
  sample(25, 'Group tasks by owner', 'OPEN', 'feature/group-by-owner',
    '## What changes\n\nDescribe how the task list can group work by owner.\n', [
      { title: 'Describe owner groups', changes: [{ path: 'README.md', before: readme, after: `${readme}\n## Owners\n\nGroup tasks by owner to see who is working on what.\n` }] },
    ], { mergeState: 'BLOCKED', review: 'REVIEW_REQUIRED', checks: [check('test', 'pending', true), check('lint', 'pass'), check('preview', 'pending')], base: 'feature/overdue-first' }),
  sample(24, 'Show overdue tasks first', 'OPEN', 'feature/overdue-first',
    '## What changes\n\nMove overdue work to the top of the release board.\n', [
      { title: 'Lead the board with overdue work', changes: [{ path: 'index.html', before: html, after: html.replace('A small team. A big launch.', 'Overdue work comes first.') }] },
    ], { mergeState: 'BLOCKED', review: 'APPROVED', checks: [check('test', 'fail', true), check('lint', 'pass'), check('preview', 'skipped')], base: 'docs/task-filters' }),
  sample(23, 'Explain the task filters', 'OPEN', 'docs/task-filters',
    '## What changes\n\nDocument the options for filtering tasks.\n', [
      { title: 'Document the task filters', changes: [{ path: 'README.md', before: readme, after: `${readme}\n## Filters\n\nSearch by title, and include completed tasks when you need them.\n` }] },
    ], { mergeState: 'BEHIND', behindBy: 2 }),
  sample(22, 'Rename the release board', 'OPEN', 'feature/board-name',
    '## What changes\n\nGive the release board a shorter headline.\n', [
      { title: 'Shorten the board headline', changes: [{ path: 'index.html', before: html, after: html.replace('A small team. A big launch.', 'Launch board.') }] },
    ], { mergeable: 'CONFLICTING', mergeState: 'DIRTY' }),
  sample(21, 'Hide completed tasks from search results', 'OPEN', 'feature/task-filters',
    '## What changes\n\nKeep the task list focused on unfinished work. Completed tasks are hidden by default; pass `includeCompleted: true` to include them.\n\n## Verification\n\n- Case-insensitive search still works.\n- Completed tasks are hidden by default.\n- Callers can opt back into completed tasks.\n', [
      { title: 'Filter out completed tasks by default', changes: [{ path: filter, before: initialFiles[filter]!, after: modifiedFilter }] },
      { title: 'Cover completed task visibility', changes: [{ path: tests, before: initialFiles[tests]!, after: initialFiles[tests]! + "\ntest('hides completed tasks by default', () => {\n  assert.deepEqual(filterTasks(tasks), [tasks[0]]);\n});\n\ntest('can include completed tasks', () => {\n  assert.deepEqual(filterTasks(tasks, '', { includeCompleted: true }), tasks);\n});\n" }] },
    ]),
  sample(20, 'Refine the release board on small screens', 'OPEN', 'feature/compact-board',
    '## What changes\n\nGive the release board more room on narrow screens, with tighter card spacing and a wider breakpoint for the single-column layout.\n\n## Review\n\nCheck the board at phone and tablet widths before merging.\n', [
      { title: 'Adjust the compact board layout', changes: [{ path: 'index.html', before: html, after: html.replace('max-width: 560px', 'max-width: 680px').replace('padding: 18px;', 'padding: 14px;') }] },
    ], { draft: true, checks: [check('test', 'pending', true), check('lint', 'pass')] }),
  sample(19, 'Document the local test command', 'MERGED', 'docs/test-command',
    '## What changes\n\nDocument how to run the task filter tests with Node.js. No extra test runner is needed.\n', [
      { title: 'Add testing instructions', changes: [{ path: 'README.md', before: initialFiles['README.md']!, after: initialFiles['README.md']! + '\n## Testing\n\nRun `npm test` to check task filtering.\n' }] },
    ]),
  sample(18, 'Try a warmer board accent', 'CLOSED', 'design/warm-accent',
    '## Exploration\n\nTry an amber accent on the release board. Closed after review: keep the original violet palette.\n', [
      { title: 'Try amber for release progress', changes: [{ path: 'index.html', before: html, after: html.replaceAll('#9da8ff', '#f0bc70') }] },
    ]),
];
// One native GitHub stack, from bottom to top, so visitors can open its layer indicator.
const stackNumber = 3;
const stackLayers = [23, 24, 25];
function stackMembership(number: number): PullRequestStackMembership | undefined {
  const position = stackLayers.indexOf(number) + 1;
  return position ? { number: stackNumber, size: stackLayers.length, position, base: 'main' } : undefined;
}
for (const sample of samples) {
  const membership = stackMembership(sample.details.number);
  if (!membership) continue;
  sample.live.stack = 'member';
  sample.live.stackMembership = membership;
}
function requireSample(number: number) {
  const result = samples.find(s => s.details.number === number);
  if (!result) throw new Error('Choose a pull request from the sample repository.');
  return result;
}
function result(changes: Change[]): DiffResult {
  const text = changes.map(c => patch(c.path, c.before, c.after)).join('');
  return { path: '', patch: text, binary: false, truncated: false, lineCount: text.split('\n').length };
}
/** The demo's signed-in GitHub account, which authors simulated comments and reviews. */
const viewer = person('opentig-demo');
const unsupported = (what: string): never => {
  throw new Error(`${what} needs a real GitHub repository. In this demo, try merging, closing, commenting on, or reviewing a sample pull request.`);
};
/** Record a change on both the PR and its live state, so later edits and reviews compare against it. */
function touch(sample: Sample) {
  const now = new Date().toISOString();
  sample.details.updatedAt = now;
  sample.live.updatedAt = now;
}
function setState(sample: Sample, state: PullRequestState) {
  sample.details.state = state;
  sample.live.state = state;
  sample.live.mergeable = state === 'OPEN' ? 'MERGEABLE' : 'UNKNOWN';
  sample.live.mergeStateStatus = state === 'OPEN' ? (sample.live.isDraft ? 'DRAFT' : 'CLEAN') : 'UNKNOWN';
  if (state !== 'OPEN') sample.live.autoMerge = null;
}
function conversationOf(number: number) {
  return (conversations[number] ??= []);
}

export const demoPulls = {
  list(states: PullRequestState[]) { return samples.filter(s => states.includes(s.details.state)).map(s => structuredClone(s.details)); },
  get(number: number) { return structuredClone(requireSample(number).details); },
  liveState(number: number) { return structuredClone(requireSample(number).live); },
  conversation(number: number) { requireSample(number); return { entries: structuredClone(conversations[number] ?? []), truncated: false, partial: false }; },
  forBranch(branch: string) { return structuredClone(samples.find(s => s.details.headRefName === branch)?.details ?? null); },
  /** Merge, close, reopen, draft, and auto-merge change the sample in memory, for this page only. */
  act(input: PullRequestActionInput): PullRequestActionResult {
    const sample = requireSample(input.number);
    const { live } = sample;
    let outcome: PullRequestActionResult['outcome'] = 'done';
    let branchDeleted = false;
    switch (input.action) {
      case 'merge':
        setState(sample, 'MERGED');
        branchDeleted = Boolean(input.deleteBranch);
        outcome = 'merged';
        break;
      case 'close': setState(sample, 'CLOSED'); break;
      case 'reopen': setState(sample, 'OPEN'); break;
      case 'draft':
      case 'ready':
        sample.details.isDraft = live.isDraft = input.action === 'draft';
        live.mergeStateStatus = live.isDraft ? 'DRAFT' : 'CLEAN';
        outcome = 'updated';
        break;
      case 'enable-auto-merge':
        live.autoMerge = { method: input.method };
        outcome = 'auto-merge-enabled';
        break;
      case 'disable-auto-merge':
        live.autoMerge = null;
        outcome = 'auto-merge-disabled';
        break;
      case 'update-branch':
        live.behindBy = 0;
        if (live.mergeStateStatus === 'BEHIND') live.mergeStateStatus = 'CLEAN';
        outcome = 'updated';
        break;
      case 'delete-branch':
        branchDeleted = true;
        break;
      case 'revert': return unsupported('Reverting a pull request');
      case 'approve-workflows': return unsupported('Approving workflow runs');
    }
    touch(sample);
    return { outcome, state: structuredClone(live), ...(branchDeleted ? { branchDeleted } : {}) };
  },
  update(input: UpdatePullRequestInput) {
    const sample = requireSample(input.number);
    sample.details.title = input.title;
    sample.details.body = input.body;
    touch(sample);
  },
  comment(input: CommentOnPullRequestInput) {
    const sample = requireSample(input.number);
    conversationOf(input.number).push({ ...comment(`demo-${Date.now()}`, viewer, input.body), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), canEdit: true, canDelete: true });
    touch(sample);
  },
  review(input: ReviewPullRequestInput) {
    const sample = requireSample(input.number);
    const verdict = ({ approve: 'APPROVED', 'request-changes': 'CHANGES_REQUESTED', comment: 'COMMENTED' } as const)[input.verdict];
    conversationOf(input.number).push({ ...review(`demo-${Date.now()}`, viewer, verdict, input.body), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    if (verdict !== 'COMMENTED') {
      sample.details.reviewDecision = sample.live.reviewDecision = verdict;
      sample.live.latestReviews = [...sample.live.latestReviews.filter(r => r.author?.login !== viewer.login), { author: viewer, verdict, outdated: false }];
    }
    touch(sample);
  },
  editEntry(input: EditPullRequestEntryInput) {
    const entry = conversationOf(input.number).find(e => e.id === input.entryId && e.canEdit);
    if (!entry) return unsupported('Editing another person\'s comment');
    entry.body = input.body;
    entry.edited = true;
    entry.updatedAt = new Date().toISOString();
  },
  deleteEntry(input: DeletePullRequestEntryInput) {
    const entries = conversationOf(input.number);
    const index = entries.findIndex(e => e.id === input.entryId && e.canDelete);
    if (index < 0) return unsupported('Deleting another person\'s comment');
    entries.splice(index, 1);
  },
  stacks(numbers: number[]) {
    return numbers.flatMap(number => {
      const stack = stackMembership(number);
      return stack ? [{ number, stack }] : [];
    });
  },
  stack(number: number): PullRequestStack | null {
    if (!stackMembership(number)) return null;
    return {
      number: stackNumber,
      base: 'main',
      layers: stackLayers.map(layer => {
        const { title, headRefName, state, isDraft } = requireSample(layer).details;
        return { number: layer, title, headRefName, state, isDraft };
      }),
    };
  },
  diff(number: number) { return result(requireSample(number).changes.flat()); },
  commitDiff(oid: string) {
    for (const sample of samples) {
      const index = sample.details.commits.findIndex(c => c.oid === oid);
      if (index >= 0) return result(sample.changes[index]!);
    }
    throw new Error('Choose a commit from a sample pull request.');
  },
};
