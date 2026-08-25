import { describe, expect, it } from 'vitest';
import { EMPTY_AI_USAGE, normalizeAiLogEntry } from './ai-log';

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: '01234567-89ab-cdef-0123-456789abcdef',
    at: '2026-08-25T15:35:41.000Z',
    operation: 'commit-message',
    harness: 'codex',
    model: 'gpt-5.6-luna',
    repositoryId: 'repo',
    status: 'failed',
    durationMs: 10,
    errorCode: 'AI_PROCESS_FAILED',
    errorMessage: null,
    usage: EMPTY_AI_USAGE,
    stagedFileCount: 1,
    contextTruncated: false,
    splitOffered: null,
    splitGroups: null,
    splitRejectedReason: null,
    splitBlockedReason: null,
    ...overrides,
  };
}

describe('normalizeAiLogEntry', () => {
  it('keeps a harness error message and flattens control characters', () => {
    const entry = normalizeAiLogEntry(record({
      errorMessage: "Invalid schema\nMissing 'rationale'.",
    }));
    expect(entry?.errorMessage).toBe("Invalid schema Missing 'rationale'.");
  });

  it('redacts credential-shaped values from the stored message', () => {
    const entry = normalizeAiLogEntry(record({
      errorMessage: 'token=super-secret failed',
    }));
    expect(entry?.errorMessage).toBe('token=[redacted] failed');
    expect(entry?.errorMessage).not.toContain('super-secret');
  });

  it('accepts a legacy entry that has no errorMessage field', () => {
    const legacy: Record<string, unknown> = record();
    delete legacy.errorMessage;
    expect(normalizeAiLogEntry(legacy)?.errorMessage).toBeNull();
  });
});
