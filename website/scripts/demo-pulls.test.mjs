import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch } from 'diff';
import { demoPulls } from '../demo/pulls.ts';
import { demoReleases } from '../demo/releases.ts';
import { demoActions } from '../demo/actions.ts';
import { DemoRepository, initialFiles, mainOid, sampleHistory } from '../demo/model.ts';
import { sampleBranches } from '../demo/branches.ts';

/** The tree a patch leaves: each file section applied to the file it names. */
function applyTo(tree, patch) {
  const next = { ...tree };
  for (const section of patch.split(/^(?=diff --git )/m).filter(Boolean)) {
    const from = /^rename from (.+)$/m.exec(section)?.[1] ?? /^--- a\/(.+)$/m.exec(section)?.[1];
    const to = /^rename to (.+)$/m.exec(section)?.[1] ?? /^\+\+\+ b\/(.+)$/m.exec(section)?.[1];
    const content = applyPatch(from ? tree[from] : '', section.slice(section.indexOf('--- ')));
    assert.equal(typeof content, 'string', `${from ?? to} applies`);
    if (from) delete next[from];
    if (to) next[to] = content;
  }
  return next;
}
const mainTree = sampleHistory.findLast(commit => commit.onMain).after;

test('HTML is a tracked sample file that can be edited, staged and committed', () => {
  const repo = new DemoRepository();
  assert.ok(repo.files().some(f => f.path === 'index.html'));
  assert.deepEqual(repo.directoryEntries(''), repo.files());
  assert.deepEqual(repo.directoryEntries('src').map(f => f.path), ['src/filter-tasks.js', 'src/progress.ts', 'src/types.ts']);
  assert.deepEqual(repo.directoryEntries('.github/workflows').map(f => f.path), ['.github/workflows/ci.yml', '.github/workflows/nightly.yml', '.github/workflows/prepare-release.yml']);
  assert.deepEqual(repo.files().filter(f => f.type === 'directory').map(f => f.name), ['.github', 'assets', 'data', 'src', 'test']);
  assert.deepEqual(repo.directoryEntries('missing'), []);
  const original = repo.read('index.html');
  const edited = original.replace('A small team. A big launch.', 'Ready for launch.');
  repo.write('index.html', edited);
  assert.equal(applyPatch(repo.index['index.html'], repo.diff('index.html', 'unstaged').patch), edited);
  repo.stage(['index.html']);
  const { oid } = repo.commit('Update release board headline');
  assert.deepEqual(repo.commitFiles(oid).map(f => f.path), ['index.html']);
  assert.equal(repo.head['index.html'], edited);
  assert.equal(repo.status().unstagedCount, 5);
});

test('PRs 23, 24, and 25 form one native stack, from bottom to top', () => {
  assert.deepEqual(demoPulls.stacks([21, 23, 24, 25]).map(entry => [entry.number, entry.stack.position, entry.stack.size]), [[23, 1, 3], [24, 2, 3], [25, 3, 3]]);
  assert.deepEqual(demoPulls.stack(24).layers.map(layer => layer.number), [23, 24, 25]);
  assert.equal(demoPulls.stack(21), null);
  assert.equal(demoPulls.liveState(24).stack, 'member');
  assert.equal(demoPulls.get(24).baseRefName, 'docs/task-filters');
});

test('PR states filter correctly and returned data cannot mutate fixtures', () => {
  assert.deepEqual(demoPulls.list(['OPEN']).map(p => p.number), [25, 24, 23, 22, 21, 20]);
  assert.equal(demoPulls.get(20).isDraft, true);
  assert.deepEqual(demoPulls.list(['MERGED', 'CLOSED']).map(p => p.number), [19, 18]);
  assert.deepEqual(demoPulls.list([]), []);
  assert.equal(demoPulls.forBranch('feature/task-filters').number, 21);
  assert.equal(demoPulls.forBranch('missing'), null);
  const pr = demoPulls.get(21);
  pr.commits.length = 0;
  assert.equal(demoPulls.get(21).commits.length, 2);
  assert.throws(() => demoPulls.get(999), /sample repository/);
  assert.throws(() => demoPulls.commitDiff('missing'), /sample pull request/);
});

test('every sample has a live state that agrees with its details', () => {
  for (const pr of demoPulls.list(['OPEN', 'MERGED', 'CLOSED'])) {
    const live = demoPulls.liveState(pr.number);
    assert.equal(live.headRefOid, pr.headRefOid);
    assert.equal(live.state, pr.state);
    assert.equal(live.isDraft, pr.isDraft);
    assert.equal(live.reviewDecision, pr.reviewDecision);
    assert.equal(live.checks.rollup, pr.checksState);
  }
  assert.deepEqual(demoPulls.list(['OPEN']).map(p => demoPulls.liveState(p.number).mergeStateStatus), ['BLOCKED', 'BLOCKED', 'BEHIND', 'DIRTY', 'CLEAN', 'DRAFT']);
  const live = demoPulls.liveState(21);
  live.checks.items.length = 0;
  assert.ok(demoPulls.liveState(21).checks.items.length > 0);
});

test('sample conversations exist for every PR and cannot mutate fixtures', () => {
  for (const pr of demoPulls.list(['OPEN', 'MERGED', 'CLOSED'])) assert.ok(Array.isArray(demoPulls.conversation(pr.number).entries));
  const conversation = demoPulls.conversation(21);
  assert.ok(conversation.entries.some(entry => entry.author.isBot));
  conversation.entries.length = 0;
  assert.ok(demoPulls.conversation(21).entries.length > 0);
  assert.throws(() => demoPulls.conversation(999), /sample repository/);
});

test('sample releases cover each state and cannot mutate fixtures', () => {
  const releases = demoReleases.list();
  assert.ok(releases.some(release => release.isDraft));
  assert.ok(releases.some(release => release.isLatest));
  assert.ok(releases.some(release => release.isPrerelease));
  for (const release of releases) {
    const details = demoReleases.get(release.tagName);
    assert.equal(details.tagName, release.tagName);
    assert.equal(details.isDraft, release.isDraft);
    assert.equal(details.publishedAt, release.publishedAt);
  }
  assert.ok(releases.filter(release => release.isDraft).some(release => !demoReleases.get(release.tagName).tagExists));
  demoReleases.get(releases[0].tagName).assets.length = 0;
  releases.length = 0;
  assert.ok(demoReleases.list().length > 0);
  assert.throws(() => demoReleases.get('missing'), /sample repository/);
});

test('sample workflows list a release workflow first', () => {
  const { workflows, defaultBranch } = demoReleases.workflows();
  assert.equal(defaultBranch, 'main');
  assert.match(workflows[0].name, /release/i);
});

test('sample Actions runs open as graphs, and the run dialog can tell manual workflows apart', () => {
  const { workflows, branches } = demoActions.runnable();
  assert.equal(branches[0], 'main');
  assert.deepEqual(workflows.filter((workflow) => workflow.triggers?.inputs !== null).map((workflow) => workflow.name), ['Prepare release', 'Nightly checks']);
  const { runs, hasMore } = demoActions.list(null);
  assert.equal(hasMore, false);
  assert.ok(runs.some((run) => run.status !== 'completed'), 'one run is still going');
  for (const run of runs) {
    const details = demoActions.get(run.id);
    const ids = new Set(details.jobs.map((job) => job.id));
    for (const node of details.graph) for (const id of node.jobIds) assert.ok(ids.has(id), `${run.title}: ${node.id} lists a known job`);
  }
  assert.deepEqual(demoActions.list(1).runs.map((run) => run.workflowId), [1, 1]);
  assert.throws(() => demoActions.get(1), /sample repository/);
});

test('sample Actions runs agree with the sample workflow files, branches, and pull requests', () => {
  const { workflows, branches } = demoActions.runnable();
  for (const workflow of workflows) assert.equal(typeof initialFiles[workflow.path], 'string', `${workflow.path} is in the sample`);
  assert.deepEqual(demoReleases.workflows().workflows.map(({ id, name, path }) => ({ id, name, path })), workflows.map(({ id, name, path }) => ({ id, name, path })));
  const open = demoPulls.list(['OPEN']);
  assert.deepEqual(new Set(branches), new Set(['main', ...open.map((pr) => pr.headRefName)]));

  const { runs } = demoActions.list(null);
  assert.equal(new Set(runs.map((run) => run.id)).size, runs.length);
  const ci = initialFiles['.github/workflows/ci.yml'];
  const toJob = { pass: 'success', fail: 'failure', skipped: 'skipped', pending: null };
  const ciRuns = runs.filter((run) => run.workflowName === 'CI');
  for (const run of ciRuns) {
    const details = demoActions.get(run.id);
    // The graph is ci.yml's: test and lint side by side, preview after test.
    assert.deepEqual(details.graph.map(({ id, needs }) => [id, needs]), [['test', []], ['lint', []], ['preview', ['test']]]);
    for (const node of details.graph) assert.match(ci, new RegExp(`^  ${node.id}:$`, 'm'));
    if (run.event === 'push') {
      assert.equal(run.branch, 'main');
      continue;
    }
    // A pull request's run is on its branch and head commit, with the results of its checks.
    const pr = demoPulls.get(run.pullRequestNumber);
    assert.equal(run.title, pr.title);
    assert.equal(run.branch, pr.headRefName);
    assert.equal(run.headSha, pr.headRefOid);
    for (const check of demoPulls.liveState(pr.number).checks.items) {
      const node = details.graph.find((item) => item.id === check.name);
      const jobs = details.jobs.filter((job) => node.jobIds.includes(job.id));
      if (check.result === 'pending' && !jobs.length) continue; // Still waiting for the jobs it needs.
      assert.equal(jobs.length, 1, `#${pr.number} ${check.name}`);
      assert.equal(jobs[0].conclusion, toJob[check.result], `#${pr.number} ${check.name}`);
    }
  }
  assert.ok(ciRuns.some((run) => run.event === 'push') && ciRuns.some((run) => run.event === 'pull_request'));

  // The running run started minutes ago, so its duration doesn't count from the sample date.
  const running = runs.find((run) => run.status !== 'completed');
  assert.ok(Date.now() - Date.parse(running.startedAt) < 60 * 60_000);
});

test('each PR diff applies to its base and agrees with its commits and totals', () => {
  for (const pr of demoPulls.list(['OPEN', 'MERGED', 'CLOSED'])) {
    assert.equal(pr.url, '');
    // The checked-out branch's pull request starts on main; the others are edits of the sample files.
    const base = pr.number === 21 ? mainTree : initialFiles;
    const full = demoPulls.diff(pr.number).patch;
    const stepwise = pr.commits.reduce((tree, commit) => applyTo(tree, demoPulls.commitDiff(commit.oid).patch), base);
    assert.deepEqual(applyTo(base, full), stepwise, `#${pr.number}`);
    assert.equal(pr.additions, full.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length);
    assert.equal(pr.deletions, full.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length);
    assert.equal(pr.changedFiles, full.split(/^(?=diff --git )/m).filter(Boolean).length);
    assert.equal(pr.headRefOid, pr.commits.at(-1).oid);
  }
  const before = demoPulls.diff(21);
  const repo = new DemoRepository();
  repo.stage(['src/filter-tasks.js']);
  repo.commit('Sample edit');
  assert.deepEqual(demoPulls.diff(21), before);
});

test("the checked-out branch's pull request is made of the branch's own commits and follows its pushes", () => {
  const repo = new DemoRepository();
  const pull = () => demoPulls.forBranch(repo.status().branch);
  // Its commits are in History under the same identifiers, and its diff ends on the files the branch has.
  assert.deepEqual(pull().commits.map(c => [c.oid, c.messageHeadline]), repo.commits.slice(0, 2).reverse().map(c => [c.info.oid, c.info.subject]));
  assert.deepEqual(demoPulls.commitDiff(pull().headRefOid).patch, repo.commitDiff(pull().headRefOid).patch);
  assert.deepEqual(applyTo(mainTree, demoPulls.diff(21).patch), initialFiles);
  assert.match(demoPulls.diff(21).patch, /^rename from src\/search\.js$/m);
  // The branch has nothing its pull request lacks until a commit is made.
  assert.equal(repo.commitsAfter(pull().headRefOid), 0);
  repo.stage(['src/filter-tasks.js']);
  repo.commit('Hide completed tasks');
  assert.equal(repo.commitsAfter(pull().headRefOid), 1);

  // The refused push finds the teammate's commit, which GitHub's pull request already has and the branch does not.
  assert.equal(repo.push().status, 'behind');
  demoPulls.branchPushed(repo.remoteBranch());
  assert.deepEqual(pull().commits.map(c => c.messageHeadline), ['Turn search into a task filter', 'Describe the task filter in the README', 'Cover an empty task list']);
  assert.equal(repo.commitsAfter(pull().headRefOid), null);
  repo.pull();
  assert.equal(repo.commitsAfter(pull().headRefOid), 1);
  repo.push();
  demoPulls.branchPushed(repo.remoteBranch());
  assert.equal(pull().headRefOid, repo.status().oid);
  assert.equal(repo.commitsAfter(pull().headRefOid), 0);
  assert.equal(pull().changedFiles, 6);
  // The file renamed by one commit and edited by a later one is still one renamed file.
  const renamed = demoPulls.diff(21).patch.split(/^(?=diff --git )/m).filter(section => section.includes('filter-tasks.js b/') || section.includes('b/src/filter-tasks.js'));
  assert.equal(renamed.length, 1);
  assert.match(renamed[0], /^rename from src\/search\.js$/m);
  assert.deepEqual(applyTo(mainTree, demoPulls.diff(21).patch), repo.head);

  // Back to the sample's branch, so the other tests start from it.
  demoPulls.branchPushed(new DemoRepository().remoteBranch());
  assert.equal(pull().commits.length, 2);
});

test('a merged pull request stops following the branch, so later commits count as new', () => {
  const base = { repositoryId: 'launchpad', expectedAccount: { login: 'opentig-demo', revision: 1 }, expectedHeadOid: '' };
  const repo = new DemoRepository();
  demoPulls.act({ ...base, number: 21, action: 'merge', method: 'SQUASH' });
  const merged = demoPulls.forBranch('feature/task-filters');
  assert.equal(merged.state, 'MERGED');
  assert.equal(repo.commitsAfter(merged.headRefOid), 0);
  repo.stage(['src/filter-tasks.js']);
  repo.commit('Hide completed tasks');
  repo.push();
  repo.pull();
  repo.push();
  demoPulls.branchPushed(repo.remoteBranch());
  assert.equal(demoPulls.get(21).headRefOid, merged.headRefOid);
  // The teammate's commit and the visitor's both came after the merge.
  assert.equal(repo.commitsAfter(merged.headRefOid), 2);
  demoPulls.act({ ...base, number: 21, action: 'reopen' });
});

test('the sample branches end on their pull requests and have last commits of different ages', () => {
  const repo = new DemoRepository();
  const branches = sampleBranches(repo);
  const local = branches.filter(branch => !branch.remote);
  assert.deepEqual(local.filter(branch => branch.current).map(branch => [branch.name, branch.oid]), [['feature/task-filters', repo.status().oid]]);
  assert.ok(local.some(branch => branch.name === 'main' && branch.oid === mainOid));
  for (const branch of branches.filter(item => !/(^|\/)main$/.test(item.name))) {
    const pull = demoPulls.forBranch(branch.name.replace(/^origin\//, ''));
    assert.equal(branch.oid, pull.headRefOid, branch.name);
    assert.equal(branch.subject, pull.commits.at(-1).messageHeadline, branch.name);
  }
  // The branch menu orders local branches by last commit: no two share a date, and by date is not by name.
  const dates = local.map(branch => Date.parse(branch.date));
  assert.equal(new Set(dates).size, local.length);
  const others = local.filter(branch => !branch.current && branch.name !== 'main');
  assert.notDeepEqual([...others].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).map(branch => branch.name), others.map(branch => branch.name));
  // A commit made in the page is the newest tip, and the remote keeps the pushed one.
  repo.stage(['README.md']);
  repo.commit('Tick the checklist');
  const after = sampleBranches(repo);
  assert.equal(after.find(branch => branch.current).oid, repo.status().oid);
  assert.equal(after.find(branch => branch.name === 'origin/feature/task-filters').oid, repo.commits[1].info.oid);
});

test('PR actions, comments, and reviews are simulated in memory', () => {
  const base = { repositoryId: 'launchpad', expectedAccount: { login: 'opentig-demo', revision: 1 } };
  const draft = demoPulls.act({ ...base, number: 20, expectedHeadOid: '', action: 'ready' });
  assert.equal(draft.outcome, 'updated');
  assert.equal(demoPulls.get(20).isDraft, false);
  assert.equal(demoPulls.act({ ...base, number: 23, expectedHeadOid: '', action: 'close' }).state.state, 'CLOSED');
  assert.equal(demoPulls.act({ ...base, number: 23, expectedHeadOid: '', action: 'reopen' }).state.state, 'OPEN');
  const merged = demoPulls.act({ ...base, number: 22, expectedHeadOid: '', action: 'merge', method: 'SQUASH', deleteBranch: true });
  assert.deepEqual([merged.outcome, merged.state.state, merged.branchDeleted], ['merged', 'MERGED', true]);
  assert.ok(demoPulls.list(['MERGED']).some(p => p.number === 22));
  assert.throws(() => demoPulls.act({ ...base, number: 24, expectedHeadOid: '', action: 'revert' }), /real GitHub repository/);

  demoPulls.comment({ ...base, number: 23, body: 'Looks good.' });
  const [own] = demoPulls.conversation(23).entries.slice(-1);
  assert.deepEqual([own.author.login, own.body, own.canEdit], ['opentig-demo', 'Looks good.', true]);
  demoPulls.editEntry({ ...base, number: 23, entryId: own.id, expectedUpdatedAt: own.updatedAt, body: 'Looks great.' });
  assert.equal(demoPulls.conversation(23).entries.at(-1).body, 'Looks great.');
  demoPulls.deleteEntry({ ...base, number: 23, entryId: own.id, expectedUpdatedAt: own.updatedAt });
  assert.equal(demoPulls.conversation(23).entries.length, 0);

  demoPulls.review({ ...base, number: 25, expectedHeadOid: '', verdict: 'request-changes', body: 'Group unassigned tasks last.' });
  assert.equal(demoPulls.liveState(25).reviewDecision, 'CHANGES_REQUESTED');
  demoPulls.update({ ...base, number: 25, title: 'Group tasks by owner and team', body: 'Updated.', expectedUpdatedAt: demoPulls.get(25).updatedAt });
  assert.equal(demoPulls.get(25).title, 'Group tasks by owner and team');
});

test('sample AI responses describe the staged files and split code from documentation', async () => {
  const { sampleCommitMessage, samplePullRequestDraft } = await import('../demo/sample-ai.ts');
  const mixed = sampleCommitMessage(['src/filter-tasks.js', 'test/filter-tasks.test.js', 'README.md']);
  assert.equal(mixed.subject, 'feat(filters): hide completed tasks by default');
  assert.deepEqual(mixed.proposal.commits.map(c => c.paths), [['src/filter-tasks.js', 'test/filter-tasks.test.js'], ['README.md']]);
  // Every sample change at once falls into three commits: the filter, the board page, and documentation.
  const repo = new DemoRepository();
  repo.stage(repo.status().changes.map(change => change.path));
  const staged = () => repo.status().changes.filter(change => change.staged).map(change => change.path);
  const { proposal } = sampleCommitMessage(staged());
  assert.deepEqual(proposal.commits.map(c => c.paths), [['src/filter-tasks.js', 'src/types.ts', 'test/filter-tasks.test.js'], ['index.html'], ['CHANGELOG.md', 'README.md']]);
  assert.equal(new Set(proposal.commits.map(c => c.fingerprint)).size, 3);
  // Following the plan as the app does: each group is staged alone, committed, and the next one follows.
  const created = [];
  for (const group of proposal.commits) {
    repo.prepareGroup(group.paths, staged());
    assert.deepEqual(staged(), [...group.paths].sort());
    created.push(repo.commit(group.message).oid);
  }
  assert.deepEqual(created.map(oid => repo.commitFiles(oid).map(file => file.path)), proposal.commits.map(c => [...c.paths].sort()));
  assert.deepEqual(repo.commits.slice(0, 3).map(c => c.info.subject), proposal.commits.map(c => c.subject).reverse());
  assert.deepEqual(repo.status().changes, []);
  assert.equal(sampleCommitMessage(['CHANGELOG.md']).proposal, null);
  assert.match(sampleCommitMessage(['CHANGELOG.md']).subject, /^docs:/);
  assert.throws(() => sampleCommitMessage([]), /Stage the changes/);
  assert.equal(samplePullRequestDraft().model, 'sample');
});
