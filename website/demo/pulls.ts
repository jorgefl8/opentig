import type { CommentOnPullRequestInput, DeletePullRequestEntryInput, DiffResult, EditPullRequestEntryInput, PullRequestActionInput, PullRequestActionResult, PullRequestCheck, PullRequestCheckState, PullRequestConversationEntry, PullRequestDetails, PullRequestLiveState, PullRequestParticipant, PullRequestStack, PullRequestStackMembership, PullRequestState, ReviewPullRequestInput, UpdatePullRequestInput } from '../../src/shared/contracts';
import { branchName, changedFiles, filePatch, initialFiles, mainOid, sampleDate, sampleHistory, type SampleCommit, type Tree } from './model.ts';

/** One commit of a pull request, as the trees before and after it. */
type Layer = Pick<SampleCommit, 'oid' | 'subject' | 'author' | 'date' | 'before' | 'after' | 'renames'>;
/** A commit of a sample written as the files it leaves changed. */
type Edit = { title: string; files: Record<string, string> };
type Sample = { details: PullRequestDetails; live: PullRequestLiveState; layers: Layer[] };
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
    review('r1', maya, 'APPROVED', 'Reads well. `filterTasks` is the name we agreed on.'),
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
/** Everything a pull request changes, from the tree it starts on to the one its last commit leaves. */
function overall(layers: Layer[]) {
  const base = layers[0]?.before ?? {};
  const head = layers.at(-1)?.after ?? base;
  // A rename counts while the file still has its new name and the old one is gone.
  const renames = Object.fromEntries(layers.flatMap(layer => Object.entries(layer.renames)).filter(([to, from]) => Object.hasOwn(head, to) && !Object.hasOwn(head, from) && Object.hasOwn(base, from)));
  return { base, head, files: changedFiles(base, head, renames) };
}
/** Write into a sample whatever follows from its commits: the list, the head, and the totals. */
function setLayers(sample: Sample, layers: Layer[]) {
  const { files } = overall(layers);
  const head = layers.at(-1)?.oid ?? '';
  sample.layers = layers;
  Object.assign(sample.details, {
    additions: files.reduce((sum, file) => sum + file.additions, 0), deletions: files.reduce((sum, file) => sum + file.deletions, 0), changedFiles: files.length,
    commits: layers.map(layer => ({ oid: layer.oid, messageHeadline: layer.subject, authoredAt: layer.date, author: layer.author, authorAvatarUrl: null })),
    headRefOid: head,
  });
  sample.live.headRefOid = head;
  sample.live.head = { ...sample.live.head!, refOid: head || null };
}
function sample(number: number, title: string, state: PullRequestState, branch: string, body: string, commits: Edit[] | Layer[], status: SampleStatus = {}): Sample {
  const { draft = false, checks = passing } = status;
  const reviewDecision = status.review ?? (state === 'MERGED' ? 'APPROVED' : null);
  let tree: Tree = initialFiles;
  const layers = commits.map((commit, index): Layer => {
    if ('oid' in commit) return commit;
    const before = tree;
    tree = { ...tree, ...commit.files };
    return { oid: `${number.toString(16).padStart(6, '0')}${index}`.padEnd(40, 'b'), subject: commit.title, author: 'OpenTig Demo', date: sampleDate, before, after: tree, renames: {} };
  });
  const result: Sample = {
    details: {
      number, title, state, isDraft: draft, author: 'OpenTig Demo', authorAvatarUrl: null,
      headRefName: branch, baseRefName: status.base ?? 'main', updatedAt: sampleDate,
      // Sample PRs have no corresponding GitHub URL.
      url: '', reviewDecision,
      additions: 0, deletions: 0, checksState: rollup(checks), body, changedFiles: 0,
      labels: [{ name: branch.startsWith('docs/') ? 'documentation' : 'enhancement', color: '818cf8' }],
      commits: [], baseRefOid: mainOid, headRefOid: '',
    },
    live: {
      id: `demo-pr-${number}`, number, state, isDraft: draft, headRefOid: '', headRefName: branch, baseRefName: status.base ?? 'main', updatedAt: sampleDate,
      // GitHub stops computing mergeability once a PR is finished.
      mergeable: state === 'OPEN' ? status.mergeable ?? 'MERGEABLE' : 'UNKNOWN',
      mergeStateStatus: state === 'OPEN' ? status.mergeState ?? (draft ? 'DRAFT' : 'CLEAN') : 'UNKNOWN',
      reviewDecision, latestReviews: reviewDecision === 'APPROVED' ? [{ author: maya, verdict: 'APPROVED', outdated: state === 'OPEN' }] : [], isCrossRepository: false, stack: 'none', autoMerge: null,
      mergeQueue: { enabled: false, queued: false }, behindBy: status.behindBy ?? 0,
      checks: { rollup: rollup(checks), items: checks, truncated: false, partial: false },
      head: { repositoryId: 'demo-repository', owner: 'demo', defaultBranch: 'main', refOid: null },
      repository: { methods: ['MERGE', 'SQUASH', 'REBASE'], defaultMethod: 'SQUASH', autoMergeAllowed: true, deleteBranchOnMerge: false },
      viewer: { canWrite: true, canUpdate: true, didAuthor: false, canUpdateBranch: true, canDeleteBranch: true },
    },
    layers: [],
  };
  setLayers(result, layers);
  return result;
}
/** The pull request of the checked-out branch. Its commits are the branch's own, so History shows them too. */
const branchPullRequest = 21;
const readme = initialFiles['README.md']!;
const samples = [
  sample(25, 'Group tasks by owner', 'OPEN', 'feature/group-by-owner',
    '## What changes\n\nDescribe how the task list can group work by owner.\n', [
      { title: 'Describe owner groups', files: { 'README.md': `${readme}\n## Owners\n\nGroup tasks by owner to see who is working on what.\n` } },
    ], { mergeState: 'BLOCKED', review: 'REVIEW_REQUIRED', checks: [check('test', 'pending', true), check('lint', 'pass'), check('preview', 'pending')], base: 'feature/overdue-first' }),
  sample(24, 'Show overdue tasks first', 'OPEN', 'feature/overdue-first',
    '## What changes\n\nMove overdue work to the top of the release board.\n', [
      { title: 'Lead the board with overdue work', files: { 'index.html': html.replace('A small team. A big launch.', 'Overdue work comes first.') } },
    ], { mergeState: 'BLOCKED', review: 'APPROVED', checks: [check('test', 'fail', true), check('lint', 'pass'), check('preview', 'skipped')], base: 'docs/task-filters' }),
  sample(23, 'Explain the task filters', 'OPEN', 'docs/task-filters',
    '## What changes\n\nDocument the options for filtering tasks.\n', [
      { title: 'Document the task filters', files: { 'README.md': `${readme}\n## Filters\n\nSearch by title, and include completed tasks when you need them.\n` } },
    ], { mergeState: 'BEHIND', behindBy: 2 }),
  sample(22, 'Rename the release board', 'OPEN', 'feature/board-name',
    '## What changes\n\nGive the release board a shorter headline.\n', [
      { title: 'Shorten the board headline', files: { 'index.html': html.replace('A small team. A big launch.', 'Launch board.') } },
    ], { mergeable: 'CONFLICTING', mergeState: 'DIRTY' }),
  sample(branchPullRequest, 'Turn search into a task filter', 'OPEN', branchName,
    '## What changes\n\nRename `searchTasks` to `filterTasks` and move it to `src/filter-tasks.js`, so the board can filter by more than the title. `node:test` tests replace the smoke script.\n\n## Verification\n\n- `npm test` covers case-insensitive search.\n- The README names the new function and file.\n',
    sampleHistory.filter(commit => !commit.onMain)),
  sample(20, 'Refine the release board on small screens', 'OPEN', 'feature/compact-board',
    '## What changes\n\nGive the release board more room on narrow screens, with tighter card spacing and a wider breakpoint for the single-column layout.\n\n## Review\n\nCheck the board at phone and tablet widths before merging.\n', [
      { title: 'Adjust the compact board layout', files: { 'index.html': html.replace('max-width: 560px', 'max-width: 680px').replace('padding: 18px;', 'padding: 14px;') } },
    ], { draft: true, checks: [check('test', 'pending', true), check('lint', 'pass')] }),
  sample(19, 'Document the local test command', 'MERGED', 'docs/test-command',
    '## What changes\n\nDocument how to run the task filter tests with Node.js. No extra test runner is needed.\n', [
      { title: 'Add testing instructions', files: { 'README.md': readme + '\n## Testing\n\nRun `npm test` to check task filtering.\n' } },
    ]),
  sample(18, 'Try a warmer board accent', 'CLOSED', 'design/warm-accent',
    '## Exploration\n\nTry an amber accent on the release board. Closed after review: keep the original violet palette.\n', [
      { title: 'Try amber for release progress', files: { 'index.html': html.replaceAll('#9da8ff', '#f0bc70') } },
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
function result(text: string): DiffResult {
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
  diff(number: number) {
    const { base, head, files } = overall(requireSample(number).layers);
    return result(files.map(file => filePatch(file, base, head)).join(''));
  },
  commitDiff(oid: string) {
    for (const sample of samples) {
      const layer = sample.layers.find(item => item.oid === oid);
      if (layer) return result(changedFiles(layer.before, layer.after, layer.renames).map(file => filePatch(file, layer.before, layer.after)).join(''));
    }
    throw new Error('Choose a commit from a sample pull request.');
  },
  /** A push reached the branch: while its pull request is open, the pull request has those commits too. */
  branchPushed(commits: SampleCommit[]) {
    const sample = requireSample(branchPullRequest);
    if (sample.details.state !== 'OPEN' || !commits.length || commits.at(-1)!.oid === sample.details.headRefOid) return;
    setLayers(sample, commits);
    touch(sample);
  },
};
