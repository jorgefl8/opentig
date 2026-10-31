import { describe, expect, it } from 'vitest';
import {
  groupProblemLogEntries,
  normalizeProblemLogEntry,
  parseProblemLogLines,
  repositoryIdFromCommandArgs,
  shouldRecordCommandProblem,
  sortProblemLogEntries,
  type ProblemLogEntry,
} from './problems-log';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    at: '2026-08-26T10:00:00.000Z',
    level: 'error',
    source: 'command',
    operation: 'pull',
    code: 'TIMEOUT',
    message: 'Could not pull changes.',
    repositoryId: '0123456789abcdef',
    ...overrides,
  };
}

describe('problem log model', () => {
  it('drops unreadable lines instead of failing the parse', () => {
    const parsed = parseProblemLogLines(`${JSON.stringify(entry())}\n{bad\n${JSON.stringify(entry({ id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', operation: 'push' }))}\n`);
    expect(parsed.map((item) => item.operation)).toEqual(['pull', 'push']);
  });

  it('redacts credential-shaped messages and keeps newest first', () => {
    const kept = normalizeProblemLogEntry(entry({ message: 'authorization: secret-token failed' }));
    expect(kept?.message).toContain('[redacted]');
    const sorted = sortProblemLogEntries([
      normalizeProblemLogEntry(entry({ id: '1'.repeat(32), at: '2026-08-26T10:00:00.000Z' }))!,
      normalizeProblemLogEntry(entry({ id: '2'.repeat(32), at: '2026-08-26T11:00:00.000Z' }))!,
    ]);
    expect(sorted[0]?.at).toBe('2026-08-26T11:00:00.000Z');
  });

  it('skips diagnostics commands, cancels, and invalid arguments', () => {
    expect(shouldRecordCommandProblem({ command: 'diagnostics:list', code: 'UNKNOWN' })).toBe(false);
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'AI_CANCELLED' })).toBe(false);
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'INVALID_ARGUMENT' })).toBe(false);
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'FILE_NOT_FOUND' })).toBe(false);
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'TIMEOUT', error: { name: 'AbortError' } })).toBe(false);
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'TIMEOUT' })).toBe(true);
  });

  it('extracts a repository id from command arguments when present', () => {
    expect(repositoryIdFromCommandArgs(['0123456789abcdef'])).toBe('0123456789abcdef');
    expect(repositoryIdFromCommandArgs([{ repositoryId: '0123456789abcdef' }])).toBe('0123456789abcdef');
    expect(repositoryIdFromCommandArgs(['C:\\repos\\app'])).toBeNull();
  });
});

describe('multi-line messages', () => {
  const entry = { id: 'one', at: '2026-10-30T00:00:00.000Z', source: 'command', level: 'error', operation: 'remove-worktree', code: 'UNKNOWN' };

  it('keeps them on one line instead of dropping the failure', () => {
    expect(normalizeProblemLogEntry({ ...entry, message: 'fatal: could not remove worktree\r\nhint: file is locked\n' }))
      .toMatchObject({ message: 'fatal: could not remove worktree hint: file is locked' });
  });

  it('keeps a message with colors, tabs, or other control characters', () => {
    expect(normalizeProblemLogEntry({ ...entry, message: '\u001b[31merror:\u001b[0m\thook\u0007 failed' })).toMatchObject({ message: 'error: hook failed' });
  });

  it('still rejects control characters in identifying fields', () => {
    expect(normalizeProblemLogEntry({ ...entry, message: 'fine', operation: 'bad\noperation' })).toBeNull();
  });
});

describe('groupProblemLogEntries', () => {
  const entry = (id: string, at: string, overrides: Partial<ProblemLogEntry> = {}): ProblemLogEntry => ({
    id, at, level: 'error', source: 'command', operation: 'gh-pr-for-branch', code: 'GH_ACCESS_DENIED', message: 'Not accessible.', repositoryId: 'one', ...overrides,
  });

  it('counts repeats of one failure with their first and last time, most recent first', () => {
    const groups = groupProblemLogEntries([
      entry('c', '2026-10-27T10:02:00.000Z'),
      entry('d', '2026-10-27T10:01:30.000Z', { repositoryId: 'two' }),
      entry('b', '2026-10-27T10:01:00.000Z'),
      entry('a', '2026-10-27T10:00:00.000Z'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ repositoryId: 'one', count: 3, firstAt: '2026-10-27T10:00:00.000Z', lastAt: '2026-10-27T10:02:00.000Z' });
    expect(groups[1]).toMatchObject({ repositoryId: 'two', count: 1 });
  });

  it('keeps different levels, codes, and messages apart', () => {
    expect(groupProblemLogEntries([
      entry('a', '2026-10-27T10:00:00.000Z'),
      entry('b', '2026-10-27T10:00:00.000Z', { level: 'warn' }),
      entry('c', '2026-10-27T10:00:00.000Z', { code: 'GH_TIMEOUT' }),
      entry('d', '2026-10-27T10:00:00.000Z', { message: 'Another.' }),
    ])).toHaveLength(4);
  });
});
