import { z } from 'zod';
import type { AiHarnessId } from './contracts';
import { redactSensitiveText } from './redaction';

export const MAX_AI_LOG_ENTRIES = 500;
/** Appends past the cap are tolerated until compaction is worth a rewrite. */
export const AI_LOG_COMPACTION_SLACK = 1.25;

export type AiLogOperation = 'commit-message' | 'pull-request-draft';
export type AiLogStatus = 'success' | 'failed' | 'cancelled';

/** Every count is nullable: a harness may not report it, and a run that died before answering reports nothing at all. */
export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
}

export const EMPTY_AI_USAGE: AiUsage = {
  inputTokens: null, outputTokens: null, reasoningTokens: null,
  cacheReadTokens: null, cacheWriteTokens: null, costUsd: null,
};

/**
 * One AI generation, recorded for diagnostics.
 *
 * Deliberately metadata only: the prompt carries the staged diff, which is
 * repository source code, and must never be written outside the repository.
 */
export interface AiLogEntry {
  id: string;
  at: string;
  operation: AiLogOperation;
  harness: AiHarnessId;
  model: string;
  repositoryId: string;
  status: AiLogStatus;
  durationMs: number;
  errorCode: string | null;
  /** Harness-facing reason, never the prompt or a diff. */
  errorMessage: string | null;
  usage: AiUsage;
  /** Commit-message runs only; null for other operations. */
  stagedFileCount: number | null;
  contextTruncated: boolean | null;
  splitOffered: boolean | null;
  splitGroups: number | null;
  /**
   * Why a split the model did offer was thrown away. The parser refuses a plan
   * for several different reasons and they all look identical from outside, so
   * without this the prompt cannot be tuned.
   */
  splitRejectedReason: string | null;
  /** Why OpenTig did not ask for a split at all. */
  splitBlockedReason: string | null;
}

const OPERATIONS: AiLogOperation[] = ['commit-message', 'pull-request-draft'];
const STATUSES: AiLogStatus[] = ['success', 'failed', 'cancelled'];
const HARNESSES: AiHarnessId[] = ['codex', 'claude', 'opencode'];
const MAX_TEXT = 200;
const MAX_ERROR_TEXT = 400;
const aiUsageRecordSchema = z.looseObject({
  inputTokens: z.unknown().optional(), outputTokens: z.unknown().optional(), reasoningTokens: z.unknown().optional(),
  cacheReadTokens: z.unknown().optional(), cacheWriteTokens: z.unknown().optional(), costUsd: z.unknown().optional(),
});
const aiLogRecordSchema = z.looseObject({
  id: z.unknown().optional(), at: z.unknown().optional(), operation: z.unknown().optional(), harness: z.unknown().optional(),
  model: z.unknown().optional(), repositoryId: z.unknown().optional(), status: z.unknown().optional(), durationMs: z.unknown().optional(),
  errorCode: z.unknown().optional(), errorMessage: z.unknown().optional(), usage: z.unknown().optional(), stagedFileCount: z.unknown().optional(), contextTruncated: z.unknown().optional(),
  splitOffered: z.unknown().optional(), splitGroups: z.unknown().optional(), splitRejectedReason: z.unknown().optional(), splitBlockedReason: z.unknown().optional(),
});

export function normalizeAiUsage(value: unknown): AiUsage {
  const parsed = aiUsageRecordSchema.safeParse(value);
  if (!parsed.success) return { ...EMPTY_AI_USAGE };
  const input = parsed.data;
  return {
    inputTokens: count(input.inputTokens),
    outputTokens: count(input.outputTokens),
    reasoningTokens: count(input.reasoningTokens),
    cacheReadTokens: count(input.cacheReadTokens),
    cacheWriteTokens: count(input.cacheWriteTokens),
    costUsd: cost(input.costUsd),
  };
}

export function normalizeAiLogEntry(value: unknown): AiLogEntry | null {
  const parsed = aiLogRecordSchema.safeParse(value);
  if (!parsed.success) return null;
  const input = parsed.data;
  const id = text(input.id, 64);
  const operation = OPERATIONS.find((item) => item === input.operation);
  const harness = HARNESSES.find((item) => item === input.harness);
  const status = STATUSES.find((item) => item === input.status);
  if (!id || !operation || !harness || !status || !isIsoDate(input.at)) return null;
  return {
    id,
    at: input.at,
    operation,
    harness,
    model: text(input.model, 200) ?? 'default',
    repositoryId: text(input.repositoryId, 64) ?? '',
    status,
    durationMs: count(input.durationMs) ?? 0,
    errorCode: text(input.errorCode, 64),
    errorMessage: diagnosticText(input.errorMessage, MAX_ERROR_TEXT),
    usage: normalizeAiUsage(input.usage),
    stagedFileCount: count(input.stagedFileCount),
    contextTruncated: flag(input.contextTruncated),
    splitOffered: flag(input.splitOffered),
    splitGroups: count(input.splitGroups),
    splitRejectedReason: text(input.splitRejectedReason, MAX_TEXT),
    splitBlockedReason: text(input.splitBlockedReason, MAX_TEXT),
  };
}

/** Parses a JSONL log, dropping unreadable lines rather than failing the read. */
export function parseAiLogLines(raw: string): AiLogEntry[] {
  const entries: AiLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = normalizeAiLogEntry(JSON.parse(line));
      if (entry) entries.push(entry);
    } catch { continue; }
  }
  return entries;
}

/**
 * Newest first, capped. Entries arrive in file order, which is append order, so
 * ties are broken by position: several runs can share a millisecond and sorting
 * those by id would scramble them and let compaction keep the wrong ones.
 */
export function sortAiLogEntries(entries: readonly AiLogEntry[]): AiLogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.at.localeCompare(left.entry.at) || right.index - left.index)
    .slice(0, MAX_AI_LOG_ENTRIES)
    .map((item) => item.entry);
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function cost(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 && !hasControlCharacters(trimmed) ? trimmed : null;
}

function diagnosticText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const flattened = flattenWhitespace(redactSensitiveText(value));
  if (!flattened) return null;
  return flattened.slice(0, maxLength);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function flattenWhitespace(value: string): string {
  let flattened = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    flattened += code < 32 || code === 127 ? ' ' : character;
  }
  return flattened.replace(/ {2,}/g, ' ').trim();
}
