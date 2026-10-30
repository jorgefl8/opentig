import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch } from 'diff';
import { demoPulls } from '../demo/pulls.ts';
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
