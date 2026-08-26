import { describe, expect, it } from 'vitest';
import {
  normalizeProblemLogEntry,
  parseProblemLogLines,
  repositoryIdFromCommandArgs,
  shouldRecordCommandProblem,
  sortProblemLogEntries,
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
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'TIMEOUT', aborted: true })).toBe(false);
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'TIMEOUT', error: { name: 'AbortError' } })).toBe(false);
    expect(shouldRecordCommandProblem({ command: 'refs:pull', code: 'TIMEOUT' })).toBe(true);
  });

  it('extracts a repository id from command arguments when present', () => {
    expect(repositoryIdFromCommandArgs(['0123456789abcdef'])).toBe('0123456789abcdef');
    expect(repositoryIdFromCommandArgs([{ repositoryId: '0123456789abcdef' }])).toBe('0123456789abcdef');
    expect(repositoryIdFromCommandArgs(['C:\\repos\\app'])).toBeNull();
  });
});
