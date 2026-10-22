import type { DiffResult, PullRequestDetails, PullRequestState } from '../../src/shared/contracts';
import { counts, initialFiles, modifiedFilter, patch, sampleDate } from './model.ts';

type Change = { path: string; before: string; after: string };
type Sample = { details: PullRequestDetails; changes: Change[][] };
const filter = 'src/filter-tasks.js';
const tests = 'test/filter-tasks.test.js';
const html = initialFiles['index.html']!;
function sample(number: number, title: string, state: PullRequestState, branch: string, body: string, commits: Array<{ title: string; changes: Change[] }>, draft = false): Sample {
  const totals = commits.flatMap(c => c.changes).reduce((sum, c) => {
    const count = counts(c.before, c.after);
    return { additions: sum.additions + count.additions, deletions: sum.deletions + count.deletions };
  }, { additions: 0, deletions: 0 });
  const oids = commits.map((_, i) => `${number.toString(16).padStart(6, '0')}${i}`.padEnd(40, 'b'));
  return {
    details: {
      number, title, state, isDraft: draft, author: 'OpenTig Demo', authorAvatarUrl: null,
      headRefName: branch, baseRefName: 'main', updatedAt: sampleDate,
      // Sample PRs have no corresponding GitHub URL.
      url: '', reviewDecision: state === 'MERGED' ? 'APPROVED' : null,
      ...totals, checksState: draft ? 'PENDING' : 'PASSING', body,
      changedFiles: new Set(commits.flatMap(c => c.changes.map(f => f.path))).size,
      labels: [{ name: branch.startsWith('docs/') ? 'documentation' : 'enhancement', color: '818cf8' }],
      commits: commits.map((c, i) => ({ oid: oids[i]!, messageHeadline: c.title, authoredAt: sampleDate, author: 'OpenTig Demo', authorAvatarUrl: null })),
      baseRefOid: 'a'.repeat(40), headRefOid: oids.at(-1) ?? '',
    },
    changes: commits.map(c => c.changes),
  };
}
const samples = [
  sample(21, 'Hide completed tasks from search results', 'OPEN', 'feature/task-filters',
    '## What changes\n\nKeep the task list focused on unfinished work. Completed tasks are hidden by default; pass `includeCompleted: true` to include them.\n\n## Verification\n\n- Case-insensitive search still works.\n- Completed tasks are hidden by default.\n- Callers can opt back into completed tasks.\n', [
      { title: 'Filter out completed tasks by default', changes: [{ path: filter, before: initialFiles[filter]!, after: modifiedFilter }] },
      { title: 'Cover completed task visibility', changes: [{ path: tests, before: initialFiles[tests]!, after: initialFiles[tests]! + "\ntest('hides completed tasks by default', () => {\n  assert.deepEqual(filterTasks(tasks), [tasks[0]]);\n});\n\ntest('can include completed tasks', () => {\n  assert.deepEqual(filterTasks(tasks, '', { includeCompleted: true }), tasks);\n});\n" }] },
    ]),
  sample(20, 'Refine the release board on small screens', 'OPEN', 'feature/compact-board',
    '## What changes\n\nGive the release board more room on narrow screens, with tighter card spacing and a wider breakpoint for the single-column layout.\n\n## Review\n\nCheck the board at phone and tablet widths before merging.\n', [
      { title: 'Adjust the compact board layout', changes: [{ path: 'index.html', before: html, after: html.replace('max-width: 560px', 'max-width: 680px').replace('padding: 18px;', 'padding: 14px;') }] },
    ], true),
  sample(19, 'Document the local test command', 'MERGED', 'docs/test-command',
    '## What changes\n\nDocument how to run the task filter tests with Node.js. No extra test runner is needed.\n', [
      { title: 'Add testing instructions', changes: [{ path: 'README.md', before: initialFiles['README.md']!, after: initialFiles['README.md']! + '\n## Testing\n\nRun `npm test` to check task filtering.\n' }] },
    ]),
  sample(18, 'Try a warmer board accent', 'CLOSED', 'design/warm-accent',
    '## Exploration\n\nTry an amber accent on the release board. Closed after review: keep the original violet palette.\n', [
      { title: 'Try amber for release progress', changes: [{ path: 'index.html', before: html, after: html.replaceAll('#9da8ff', '#f0bc70') }] },
    ]),
];
function requireSample(number: number) {
  const result = samples.find(s => s.details.number === number);
  if (!result) throw new Error('Choose a pull request from the sample repository.');
  return result;
}
function result(changes: Change[]): DiffResult {
  const text = changes.map(c => patch(c.path, c.before, c.after)).join('');
  return { path: '', patch: text, binary: false, truncated: false, lineCount: text.split('\n').length };
}
export const demoPulls = {
  list(states: PullRequestState[]) { return samples.filter(s => states.includes(s.details.state)).map(s => structuredClone(s.details)); },
  get(number: number) { return structuredClone(requireSample(number).details); },
  forBranch(branch: string) { return structuredClone(samples.find(s => s.details.headRefName === branch)?.details ?? null); },
  diff(number: number) { return result(requireSample(number).changes.flat()); },
  commitDiff(oid: string) {
    for (const sample of samples) {
      const index = sample.details.commits.findIndex(c => c.oid === oid);
      if (index >= 0) return result(sample.changes[index]!);
    }
    throw new Error('Choose a commit from a sample pull request.');
  },
};
