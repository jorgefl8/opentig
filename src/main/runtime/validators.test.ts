import { describe, expect, it } from 'vitest';
import { booleanArg, branchDetailsArg, deleteBranchArg, filesTreeStateArg, nullableProjectIdArg, openFilesStateArg, prepareCommitGroupArg, projectIdArg, projectNameArg, pullRequestStatesArg, removeWorktreeArg, repositoryKeyArg, searchOptionsArg, searchReplaceArg, worktreeDetailsArg } from './validators';
import { GitOperationError } from '../../shared/errors';

const OID = 'a'.repeat(40);
const REVISION = 'b'.repeat(64);

describe('boolean argument validator', () => {
  it('accepts booleans and applies the default for omitted values', () => {
    expect(booleanArg(true, 'status')).toBe(true);
    expect(booleanArg(undefined, 'status', true)).toBe(true);
  });

  it('rejects non-booleans as a generic invalid argument', () => {
    try { booleanArg('yes', 'status'); } catch (error) {
      expect(error).toBeInstanceOf(GitOperationError);
      expect(error).toMatchObject({ detail: { code: 'INVALID_ARGUMENT', operation: 'status', message: 'Invalid argument.' } });
    }
  });
});

describe('search replacement validator', () => {
  it('keeps legacy boolean defaults and strips unknown request fields', () => {
    expect(searchOptionsArg({ query: 'term', matchCase: 'yes', extra: 'ignored' }, 'search')).toEqual({
      query: 'term', matchCase: false, wholeWord: false, regex: false, includeIgnored: false,
    });
  });

  it('preserves the public domain error instead of exposing validation details', () => {
    try { searchOptionsArg({ query: 'bad\0query' }, 'search'); } catch (error) {
      expect(error).toBeInstanceOf(GitOperationError);
      expect(error).toMatchObject({ detail: { code: 'INVALID_ARGUMENT', operation: 'search', message: 'Invalid search.' } });
    }
  });
  it('accepts an exact match scope and normalizes search booleans', () => {
    expect(searchReplaceArg({
      options: { query: 'foo', regex: false }, replacement: 'bar',
      scope: { kind: 'match', path: 'src/app.ts', revision: REVISION, line: 2, column: 4 },
    }, 'test')).toEqual({
      options: { query: 'foo', matchCase: false, wholeWord: false, regex: false, includeIgnored: false }, replacement: 'bar',
      scope: { kind: 'match', path: 'src/app.ts', revision: REVISION, line: 2, column: 4 },
    });
  });

  it('rejects malformed revisions, empty batches, and invalid coordinates', () => {
    const options = { query: 'foo', matchCase: false, wholeWord: false, regex: false, includeIgnored: false };
    expect(() => searchReplaceArg({ options, replacement: 'bar', scope: { kind: 'file', path: 'a', revision: 'bad' } }, 'test')).toThrow();
    expect(() => searchReplaceArg({ options, replacement: 'bar', scope: { kind: 'all', files: [] } }, 'test')).toThrow();
    expect(() => searchReplaceArg({ options, replacement: 'bar', scope: { kind: 'match', path: 'a', revision: REVISION, line: 0, column: 1 } }, 'test')).toThrow();
  });
});

describe('pull request state validator', () => {
  it('accepts granular states and returns them in canonical order', () => {
    expect(pullRequestStatesArg(['MERGED', 'OPEN'], 'test')).toEqual(['OPEN', 'MERGED']);
    expect(pullRequestStatesArg([], 'test')).toEqual([]);
  });

  it('rejects unknown, duplicate, or excessive state selections', () => {
    expect(() => pullRequestStatesArg(['OPEN', 'open'], 'test')).toThrow();
    expect(() => pullRequestStatesArg(['OPEN', 'OPEN'], 'test')).toThrow();
    expect(() => pullRequestStatesArg(['OPEN', 'CLOSED', 'MERGED', 'OPEN'], 'test')).toThrow();
    expect(() => pullRequestStatesArg('OPEN', 'test')).toThrow();
  });
});

describe('commit group validator', () => {
  it('accepts a bounded group and optional staged fingerprint', () => {
    expect(prepareCommitGroupArg({ repositoryId: 'repo', paths: ['src/app.ts'], expectedStagedPaths: [], expectedFingerprint: 'a'.repeat(64) }, 'test')).toEqual({
      repositoryId: 'repo', paths: ['src/app.ts'], expectedStagedPaths: [], expectedFingerprint: 'a'.repeat(64),
    });
  });

  it('rejects missing paths and malformed fingerprints', () => {
    expect(() => prepareCommitGroupArg({ repositoryId: 'repo', paths: [], expectedStagedPaths: [] }, 'test')).toThrow();
    expect(() => prepareCommitGroupArg({ repositoryId: 'repo', paths: ['a'], expectedStagedPaths: [], expectedFingerprint: 'not-a-hash' }, 'test')).toThrow();
  });
});

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
    expect(request).toEqual({ repositoryId: '0123456789abcdef', fullName: 'refs/heads/función/ñandú', expectedOid: OID, force: true });
    expect(request).not.toBe(source);
  });

  it('accepts valid branch and worktree targets', () => {
    expect(branchDetailsArg({ repositoryId: 'repo', fullName: 'refs/heads/main' }, 'test')).toEqual({ repositoryId: 'repo', fullName: 'refs/heads/main' });
    expect(worktreeDetailsArg({ repositoryId: 'repo', path: 'C:\\Mis Repos\\aplicación' }, 'test')).toEqual({ repositoryId: 'repo', path: 'C:\\Mis Repos\\aplicación' });
    expect(removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app trees\\review', expectedOid: OID.toUpperCase(), force: true, deleteBranch: true }, 'test'))
      .toEqual({ repositoryId: 'repo', path: 'C:\\repos\\app trees\\review', expectedOid: OID.toUpperCase(), force: true, deleteBranch: true });
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
    expect(deleteBranchArg({ repositoryId: 'repo', fullName: 'refs/heads/main', expectedOid: OID }, 'test'))
      .toEqual({ repositoryId: 'repo', fullName: 'refs/heads/main', expectedOid: OID, force: false });
    expect(() => deleteBranchArg({ repositoryId: 'repo', fullName: 'refs/heads/main', expectedOid: OID, force: 'yes' }, 'test')).toThrow();
    expect(() => removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app' }, 'test')).toThrow();
    expect(removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app', expectedOid: OID }, 'test'))
      .toEqual({ repositoryId: 'repo', path: 'C:\\repos\\app', expectedOid: OID, force: false, deleteBranch: false });
    expect(() => removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app', expectedOid: OID, force: 'yes', deleteBranch: false }, 'test')).toThrow();
    expect(() => removeWorktreeArg({ repositoryId: 'repo', path: 'C:\\repos\\app', expectedOid: OID, force: false, deleteBranch: 'yes' }, 'test')).toThrow();
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

describe('open files state validator', () => {
  const ID = '0123456789abcdef';

  it('returns a canonical, newly allocated state with normalized paths', () => {
    const tabs = [{ path: 'src\\a.ts', pinned: false }, { path: 'src/b.ts', pinned: true }, { path: 'src/a.ts', pinned: true }];
    const result = openFilesStateArg(ID, tabs, 'src/b.ts', 'src/a.ts', 'test');
    expect(result).toEqual({
      repositoryId: ID,
      tabs: [{ path: 'src/a.ts', pinned: false }, { path: 'src/b.ts', pinned: true }],
      activePath: 'src/b.ts',
      previewPath: 'src/a.ts',
    });
    expect(result.tabs[0]).not.toBe(tabs[0]);
  });

  it('accepts null active and preview paths', () => {
    expect(openFilesStateArg(ID, [{ path: 'a.ts', pinned: false }], null, undefined, 'test')).toEqual({
      repositoryId: ID,
      tabs: [{ path: 'a.ts', pinned: false }],
      activePath: null,
      previewPath: null,
    });
  });

  it('rejects invalid IDs, malformed tabs, unsafe paths, and oversized arrays', () => {
    expect(() => openFilesStateArg('repo', [{ path: 'a.ts', pinned: false }], null, null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, 'a.ts', null, null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, ['a.ts'], null, null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, [{ path: 'a.ts' }], null, null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, [{ path: '../a.ts', pinned: false }], null, null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, [{ path: 'bad\npath.ts', pinned: false }], null, null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, [{ path: 'nul\0.ts', pinned: false }], null, null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, Array.from({ length: 51 }, (_, index) => ({ path: `f${index}.ts`, pinned: false })), null, null, 'test')).toThrow();
  });

  it('rejects active or preview paths that are not open tabs', () => {
    const tabs = [{ path: 'a.ts', pinned: false }];
    expect(() => openFilesStateArg(ID, tabs, 'b.ts', null, 'test')).toThrow();
    expect(() => openFilesStateArg(ID, tabs, 'a.ts', 'b.ts', 'test')).toThrow();
  });

  it('ignores a renderer-supplied timestamp instead of trusting it', () => {
    const result = openFilesStateArg(ID, [{ path: 'a.ts', pinned: false, updatedAt: '2099-01-01T00:00:00.000Z' }], 'a.ts', null, 'test');
    expect(result.tabs[0]).toEqual({ path: 'a.ts', pinned: false });
    expect(result).not.toHaveProperty('updatedAt');
  });
});
