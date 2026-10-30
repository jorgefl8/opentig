import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch } from 'diff';
import { demoPulls } from '../demo/pulls.ts';
import { demoReleases } from '../demo/releases.ts';
import { DemoRepository, initialFiles } from '../demo/model.ts';

test('HTML is a tracked sample file that can be edited, staged and committed', () => {
  const repo = new DemoRepository();
  assert.ok(repo.files().some(f => f.path === 'index.html'));
  assert.deepEqual(repo.directoryEntries(''), repo.files());
  assert.deepEqual(repo.directoryEntries('src').map(f => f.path), ['src/filter-tasks.js']);
  assert.deepEqual(repo.directoryEntries('missing'), []);
  const original = repo.read('index.html');
  const edited = original.replace('A small team. A big launch.', 'Ready for launch.');
  repo.write('index.html', edited);
  assert.equal(applyPatch(original, repo.diff('index.html', 'unstaged').patch), edited);
  repo.stage(['index.html']);
  const { oid } = repo.commit('Update release board headline');
  assert.deepEqual(repo.commitFiles(oid).map(f => f.path), ['index.html']);
  assert.equal(repo.head['index.html'], edited);
  assert.equal(repo.status().unstagedCount, 3);
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

test('sample workflows list a release workflow first, with its recent runs', () => {
  const { workflows, defaultBranch } = demoReleases.workflows();
  assert.equal(defaultBranch, 'main');
  assert.match(workflows[0].name, /release/i);
  assert.ok(demoReleases.workflowRuns(workflows[0].path).length > 0);
  assert.deepEqual(demoReleases.workflowRuns('missing'), []);
});

test('per-commit patches apply to the sample files and compose the full PR diff', () => {
  for (const pr of demoPulls.list(['OPEN', 'MERGED', 'CLOSED'])) {
    assert.equal(pr.url, '');
    const patches = pr.commits.map(c => demoPulls.commitDiff(c.oid).patch);
    assert.equal(demoPulls.diff(pr.number).patch, patches.join(''));
    const changedPaths = new Set();
    let additions = 0, deletions = 0;
    for (const patch of patches) {
      const path = /^--- a\/(.+)$/m.exec(patch)[1];
      assert.equal(typeof applyPatch(initialFiles[path], patch), 'string');
      changedPaths.add(path);
      additions += patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      deletions += patch.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length;
    }
    assert.equal(pr.additions, additions);
    assert.equal(pr.deletions, deletions);
    assert.equal(pr.changedFiles, changedPaths.size);
  }
  const before = demoPulls.diff(21);
  const repo = new DemoRepository();
  repo.stage(['src/filter-tasks.js']);
  repo.commit('Sample edit');
  assert.deepEqual(demoPulls.diff(21), before);
});
