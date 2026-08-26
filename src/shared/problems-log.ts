import { z } from 'zod';
import { redactSensitiveText } from './redaction';

export const MAX_PROBLEM_LOG_ENTRIES = 500;
export const PROBLEM_LOG_COMPACTION_SLACK = 1.25;

export type ProblemLogLevel = 'error' | 'warn';
export type ProblemLogSource = 'command' | 'client' | 'persistence' | 'server';

export interface ProblemLogEntry {
  id: string;
  at: string;
  level: ProblemLogLevel;
  source: ProblemLogSource;
  operation: string;
  code: string | null;
  message: string;
  repositoryId: string | null;
}

export interface ProblemLogRecordInput {
  level?: ProblemLogLevel;
  source: ProblemLogSource;
  operation: string;
  code?: string | null;
  message: string;
  repositoryId?: string | null;
}

const LEVELS: ProblemLogLevel[] = ['error', 'warn'];
const SOURCES: ProblemLogSource[] = ['command', 'client', 'persistence', 'server'];
const MAX_TEXT = 400;
const problemLogRecordSchema = z.looseObject({
  id: z.unknown().optional(),
  at: z.unknown().optional(),
  level: z.unknown().optional(),
  source: z.unknown().optional(),
  operation: z.unknown().optional(),
  code: z.unknown().optional(),
  message: z.unknown().optional(),
  repositoryId: z.unknown().optional(),
});

export function normalizeProblemLogEntry(value: unknown): ProblemLogEntry | null {
  const parsed = problemLogRecordSchema.safeParse(value);
  if (!parsed.success) return null;
  const input = parsed.data;
  const id = text(input.id, 64);
  const source = SOURCES.find((item) => item === input.source);
  const level = LEVELS.find((item) => item === input.level) ?? 'error';
  const operation = text(input.operation, 80);
  const message = text(input.message, MAX_TEXT);
  if (!id || !source || !operation || !message || !isIsoDate(input.at)) return null;
  return {
    id,
    at: input.at,
    level,
    source,
    operation,
    code: text(input.code, 64),
    message,
    repositoryId: text(input.repositoryId, 64) ?? null,
  };
}

export function parseProblemLogLines(raw: string): ProblemLogEntry[] {
  const entries: ProblemLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = normalizeProblemLogEntry(JSON.parse(line));
      if (entry) entries.push(entry);
    } catch { continue; }
  }
  return entries;
}

export function sortProblemLogEntries(entries: readonly ProblemLogEntry[]): ProblemLogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.at.localeCompare(left.entry.at) || right.index - left.index)
    .slice(0, MAX_PROBLEM_LOG_ENTRIES)
    .map((item) => item.entry);
}

export function shouldRecordCommandProblem(input: {
  command: string;
  code: string;
  aborted?: boolean;
  error?: unknown;
}): boolean {
  if (input.command.startsWith('diagnostics:')) return false;
  if (input.aborted || isAbortError(input.error)) return false;
  if (input.code === 'AI_CANCELLED' || input.code === 'INVALID_ARGUMENT') return false;
  return true;
}

export function repositoryIdFromCommandArgs(args: unknown): string | null {
  if (!Array.isArray(args)) return null;
  const first = args[0];
  if (typeof first === 'string' && /^[0-9a-f]{16}$/i.test(first)) return first;
  if (first && typeof first === 'object' && 'repositoryId' in first) {
    const id = (first as { repositoryId?: unknown }).repositoryId;
    return typeof id === 'string' && /^[0-9a-f]{16}$/i.test(id) ? id : null;
  }
  return null;
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = redactSensitiveText(value.trim()).slice(0, maxLength);
  return trimmed.length > 0 && !hasControlCharacters(trimmed) ? trimmed : null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
