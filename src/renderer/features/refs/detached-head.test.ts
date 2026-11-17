import { expect, it } from 'vitest';
import type { BranchInfo } from '../../../shared/git-types';
import { checkoutLabel, describeDetachedHead, detachedHeadLabel, shortCommitId } from './detached-head';

const head = 'a'.repeat(40);
const branch = (name: string, oid: string, extra: Partial<BranchInfo> = {}) => ({
  name, fullName: extra.remote ? `refs/remotes/${name}` : `refs/heads/${name}`, oid, shortOid: oid.slice(0, 9), subject: 'Merge the release', current: false, remote: false, ...extra,
}) as BranchInfo;

it('names the commit and every branch whose tip it is, local ones first', () => {
  const branches = [
    branch('origin/main', head, { remote: true }),
    branch('origin', head, { remote: true, fullName: 'refs/remotes/origin/HEAD' }),
    branch('feature', 'b'.repeat(40)),
    branch('main', head),
  ];
  expect(describeDetachedHead({ detached: true, oid: head }, branches)).toEqual({
    label: 'Detached at aaaaaaaaa', shortOid: 'aaaaaaaaa', subject: 'Merge the release', branches: ['main', 'origin/main'],
  });
});

it('says only the commit when no branch points there, since its title would need a new read', () => {
  expect(describeDetachedHead({ detached: true, oid: head }, [branch('main', 'b'.repeat(40))])).toEqual({
    label: 'Detached at aaaaaaaaa', shortOid: 'aaaaaaaaa', subject: null, branches: [],
  });
});

it('keeps Git\'s own abbreviation of a commit, and otherwise the longest Git uses in the repository', () => {
  // A large repository: Git abbreviates to 10, and lengthened one ambiguous tip to 11.
  const branches = [branch('main', 'c'.repeat(40), { shortOid: 'c'.repeat(11) }), branch('release', 'd'.repeat(40), { shortOid: 'd'.repeat(10) })];
  // Git's own for that very commit, as a tip on it or a commit read with it, which `git checkout` takes.
  expect(shortCommitId('c'.repeat(40), branches)).toBe('c'.repeat(11));
  expect(shortCommitId(head, branches, 'a'.repeat(12))).toBe('a'.repeat(12));
  expect(describeDetachedHead({ detached: true, oid: head }, [...branches, branch('topic', head, { shortOid: 'a'.repeat(12) })])!.label).toBe(`Detached at ${'a'.repeat(12)}`);
  // Otherwise never shorter than Git needs elsewhere in the repository, nor than 7.
  expect(shortCommitId(head, branches)).toBe('a'.repeat(11));
  expect(detachedHeadLabel(head, branches)).toBe(`Detached at ${'a'.repeat(11)}`);
  expect(shortCommitId(head, [])).toBe('aaaaaaa');
});

it('names the branch when one is checked out, and the commit only when HEAD is detached', () => {
  expect(checkoutLabel({ branch: 'main', detached: false, oid: head }, [])).toBe('main');
  expect(checkoutLabel({ branch: null, detached: true, oid: head }, [])).toBe('Detached at aaaaaaa');
  expect(checkoutLabel({ branch: null, detached: true, oid: null }, [])).toBe('Detached HEAD');
  expect(describeDetachedHead({ detached: false, oid: head }, [branch('main', head)])).toBeNull();
});
