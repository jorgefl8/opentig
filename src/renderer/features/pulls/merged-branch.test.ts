import { expect, it } from 'vitest';
import { mergedBranchCleanUpStep, type MergedBranchCleanUp } from './merged-branch';

const branch: MergedBranchCleanUp = { kind: 'branch', from: '/sample', branch: 'refs/heads/feature', base: { name: 'main', fullName: 'refs/heads/main' } };
const worktree: MergedBranchCleanUp = { kind: 'worktree', from: '/sample-feature', mainPath: '/sample' };
const still = { repositoryPath: '/sample', branch: 'feature', switching: true, conflicts: false };

it('offers the deletion only once the switch really left the merged branch', () => {
  // The switch is running, or waiting on its local-changes or agents prompt.
  expect(mergedBranchCleanUpStep(branch, still)).toBe('wait');
  expect(mergedBranchCleanUpStep(branch, { ...still, branch: 'main', switching: false })).toBe('open');
  // Cancelled or failed: a later, unrelated switch to the base must not open the manager.
  expect(mergedBranchCleanUpStep(branch, { ...still, switching: false })).toBe('drop');
  expect(mergedBranchCleanUpStep(branch, { ...still, repositoryPath: '/elsewhere', branch: 'main' })).toBe('drop');
  // Moved changes that conflicted come first.
  expect(mergedBranchCleanUpStep(branch, { ...still, branch: 'main', switching: false, conflicts: true })).toBe('drop');
});

it('offers to remove a linked worktree only once the main one is open', () => {
  const inside = { repositoryPath: '/sample-feature', branch: 'feature', switching: true, conflicts: false };
  expect(mergedBranchCleanUpStep(worktree, inside)).toBe('wait');
  expect(mergedBranchCleanUpStep(worktree, { ...inside, repositoryPath: '/sample', branch: null, switching: false })).toBe('open');
  expect(mergedBranchCleanUpStep(worktree, { ...inside, switching: false })).toBe('drop');
  expect(mergedBranchCleanUpStep(worktree, { ...inside, repositoryPath: '/other-worktree' })).toBe('drop');
});
