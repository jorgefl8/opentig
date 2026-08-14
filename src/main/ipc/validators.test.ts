import { describe, expect, it } from 'vitest';
import { branchDetailsArg, deleteBranchArg, filesTreeStateArg, nullableProjectIdArg, projectIdArg, projectNameArg, removeWorktreeArg, repositoryKeyArg, worktreeDetailsArg } from './validators';

const OID = 'a'.repeat(40);

describe('repository project validators', () => {
  it('trims names and normalizes repository keys', () => {
    expect(projectNameArg('  Client work  ', 'test')).toBe('Client work');
    expect(repositoryKeyArg('C:\\Work\\Repo\\.git\\', 'test')).toBe('c:/work/repo/.git');
  });

  it('accepts explicit null only for an unassigned project', () => {
    expect(nullableProjectIdArg(null, 'test')).toBeNull();
    expect(nullableProjectIdArg('project-id', 'test')).toBe('project-id');
    expect(() => projectIdArg(null, 'test')).toThrow();
    expect(() => nullableProjectIdArg(undefined, 'test')).toThrow();
  });

  it('rejects blanks, controls, excessive lengths, and wrong types', () => {
    expect(() => projectNameArg('   ', 'test')).toThrow();
    expect(() => projectNameArg('bad\nname', 'test')).toThrow();
    expect(() => projectNameArg('x'.repeat(61), 'test')).toThrow();
    expect(() => projectIdArg('x'.repeat(65), 'test')).toThrow();
    expect(() => repositoryKeyArg('', 'test')).toThrow();
    expect(() => repositoryKeyArg([], 'test')).toThrow();
  });
});

describe('local refs management validators', () => {
  it('returns newly allocated typed objects with only the expected fields', () => {
    const source = { repositoryId: '0123456789abcdef', fullName: 'refs/heads/función/ñandú', expectedOid: OID, force: true };
    const request = deleteBranchArg(source, 'test');
    expect(request).toEqual({ repositoryId: '0123456789abcdef', fullName: 'refs/heads/función/ñandú', expectedOid: OID });
    expect(request).not.toBe(source);
    expect('force' in request).toBe(false);
  });

  it('accepts valid branch and worktree targets', () => {
    expect(branchDetailsArg({ repositoryId: 'repo', fullName: 'refs/heads/main' }, 'test')).toEqual({ repositoryId: 'repo', fullName: 'refs/heads/main' });
    expect(worktreeDetailsArg({ repositoryId: 'repo', path: 'C:\\Mis Repos\\aplicación' }, 'test')).toEqual({ repositoryId: 'repo', path: 'C:\\Mis Repos\\aplicación' });
    expect(removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app trees\\review', expectedOid: OID.toUpperCase() }, 'test'))
      .toEqual({ repositoryId: 'repo', path: 'C:\\repos\\app trees\\review', expectedOid: OID.toUpperCase() });
  });

  it('rejects arrays, null, and non-objects', () => {
    for (const value of [null, undefined, 'refs/heads/main', 42, [], [{ repositoryId: 'repo', fullName: 'refs/heads/main' }]]) {
      expect(() => branchDetailsArg(value, 'test')).toThrow();
      expect(() => worktreeDetailsArg(value, 'test')).toThrow();
    }
  });

  it('rejects missing fields and wrong field types', () => {
    expect(() => branchDetailsArg({ repositoryId: 'repo' }, 'test')).toThrow();
    expect(() => branchDetailsArg({ fullName: 'refs/heads/main' }, 'test')).toThrow();
    expect(() => branchDetailsArg({ repositoryId: 'repo', fullName: ['refs/heads/main'] }, 'test')).toThrow();
    expect(() => worktreeDetailsArg({ repositoryId: 'repo', path: null }, 'test')).toThrow();
    expect(() => deleteBranchArg({ repositoryId: 'repo', fullName: 'refs/heads/main' }, 'test')).toThrow();
    expect(() => removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app' }, 'test')).toThrow();
  });

  it('rejects empty, oversized, and control-bearing strings', () => {
    expect(() => branchDetailsArg({ repositoryId: '', fullName: 'refs/heads/main' }, 'test')).toThrow();
    expect(() => branchDetailsArg({ repositoryId: 'repo', fullName: '' }, 'test')).toThrow();
    expect(() => branchDetailsArg({ repositoryId: 'x'.repeat(65), fullName: 'refs/heads/main' }, 'test')).toThrow();
    expect(() => branchDetailsArg({ repositoryId: 'repo', fullName: 'x'.repeat(513) }, 'test')).toThrow();
    expect(() => branchDetailsArg({ repositoryId: 'repo', fullName: 'refs/heads/ma\0in' }, 'test')).toThrow();
    expect(() => branchDetailsArg({ repositoryId: 'repo', fullName: 'refs/heads/ma\nin' }, 'test')).toThrow();
    expect(() => worktreeDetailsArg({ repositoryId: 'repo', path: 'C:\\' + 'x'.repeat(4_096) }, 'test')).toThrow();
    expect(() => worktreeDetailsArg({ repositoryId: 'repo', path: 'C:\\repos\\ap\u007fp' }, 'test')).toThrow();
  });

  it('rejects malformed expected OIDs', () => {
    for (const expectedOid of ['', 'not-an-oid', 'a'.repeat(39), 'a'.repeat(65), 'g'.repeat(40), OID + '\n', 12345, null]) {
      expect(() => deleteBranchArg({ repositoryId: 'repo', fullName: 'refs/heads/main', expectedOid }, 'test')).toThrow();
      expect(() => removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app', expectedOid }, 'test')).toThrow();
    }
  });
});

describe('Files tree state validator', () => {
  it('normalizes and deduplicates bounded paths', () => {
    expect(filesTreeStateArg('0123456789abcdef', ['src\\renderer', 'src/renderer'], 'test')).toEqual({
      repositoryId: '0123456789abcdef',
      expandedPaths: ['src/renderer'],
    });
  });

  it('rejects invalid IDs, containers, traversal, controls, and oversized arrays', () => {
    expect(() => filesTreeStateArg('repo', ['src'], 'test')).toThrow();
    expect(() => filesTreeStateArg('0123456789abcdef', 'src', 'test')).toThrow();
    expect(() => filesTreeStateArg('0123456789abcdef', ['../src'], 'test')).toThrow();
    expect(() => filesTreeStateArg('0123456789abcdef', ['bad\npath'], 'test')).toThrow();
    expect(() => filesTreeStateArg('0123456789abcdef', Array.from({ length: 501 }, () => 'src'), 'test')).toThrow();
  });
});
