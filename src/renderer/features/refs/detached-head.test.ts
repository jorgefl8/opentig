import { expect, it } from 'vitest';
import type { BranchInfo } from '../../../shared/git-types';
import { checkoutLabel, describeDetachedHead } from './detached-head';

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
    label: 'Detached at aaaaaaa', shortOid: 'aaaaaaa', subject: null, branches: [],
  });
});

it('names the branch when one is checked out, and the commit only when HEAD is detached', () => {
  expect(checkoutLabel({ branch: 'main', detached: false, oid: head }, [])).toBe('main');
  expect(checkoutLabel({ branch: null, detached: true, oid: head }, [])).toBe('Detached at aaaaaaa');
  expect(checkoutLabel({ branch: null, detached: true, oid: null }, [])).toBe('Detached HEAD');
  expect(describeDetachedHead({ detached: false, oid: head }, [branch('main', head)])).toBeNull();
});
