import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_PROBLEM_LOG_ENTRIES,
  PROBLEM_LOG_COMPACTION_SLACK,
  normalizeProblemLogEntry,
  parseProblemLogLines,
  sortProblemLogEntries,
  type ProblemLogEntry,
  type ProblemLogRecordInput,
} from '../../shared/problems-log';
import { writeFileAtomically } from './atomicWrite';

export interface ProblemLogRecorder {
  record(entry: ProblemLogRecordInput): void;
}

export function recordProblemSafely(log: ProblemLogRecorder | undefined, entry: ProblemLogRecordInput): void {
  try { log?.record(entry); } catch { /* a lost diagnostic must never fail the user action */ }
}

export function problemsLogPathFromSettings(settingsPath: string): string {
  return path.join(path.dirname(settingsPath), 'problems.jsonl');
}

export class ProblemsLogStore implements ProblemLogRecorder {
  private lines = 0;
  private loaded = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.lines = (await this.readEntries()).length;
    this.loaded = true;
  }

  record(entry: ProblemLogRecordInput): void {
    const record: ProblemLogEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      level: entry.level ?? 'error',
      source: entry.source,
      operation: entry.operation,
      code: entry.code ?? null,
      message: entry.message,
      repositoryId: entry.repositoryId ?? null,
    };
    const normalized = normalizeProblemLogEntry(record);
    if (!normalized) return;
    this.pending = this.pending
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
        this.lines += 1;
        if (this.lines > MAX_PROBLEM_LOG_ENTRIES * PROBLEM_LOG_COMPACTION_SLACK) await this.compact();
      })
      .catch(() => undefined);
  }

  async list(): Promise<ProblemLogEntry[]> {
    await this.flush();
    return sortProblemLogEntries(await this.readEntries());
  }

  async clear(): Promise<void> {
    await this.flush();
    await writeFileAtomically(this.filePath, '');
    this.lines = 0;
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private async readEntries(): Promise<ProblemLogEntry[]> {
    try {
      return parseProblemLogLines(await readFile(this.filePath, 'utf8'));
    } catch {
      return [];
    }
  }

  private async compact(): Promise<void> {
    const kept = sortProblemLogEntries(await this.readEntries());
    const body = kept.map((entry) => JSON.stringify(entry)).join('\n');
    await writeFileAtomically(this.filePath, body ? `${body}\n` : '');
    this.lines = kept.length;
  }
}
