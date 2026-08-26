import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomically } from './atomicWrite';
import {
  AI_LOG_COMPACTION_SLACK, type AiLogEntry, type AiLogStatus, MAX_AI_LOG_ENTRIES, normalizeAiLogEntry, parseAiLogLines, sortAiLogEntries,
} from '../../shared/ai-log';
import { AiOperationError } from '../../shared/errors';

/** The write side, so the AI services depend on recording rather than on storage. */
export interface AiLogRecorder {
  append(entry: Omit<AiLogEntry, 'id' | 'at'>): void;
}

/**
 * Records a run without ever letting the attempt reach the caller. Diagnostics
 * are worth losing; the result the user asked for is not.
 */
export function recordSafely(log: AiLogRecorder | undefined, entry: Omit<AiLogEntry, 'id' | 'at'>): void {
  try { log?.append(entry); } catch { /* a lost diagnostic must never fail a generation */ }
}

export function failureLogFields(error: unknown): { status: AiLogStatus; errorCode: string; errorMessage: string | null } {
  const code = error instanceof AiOperationError ? error.detail.code : 'AI_PROCESS_FAILED';
  return {
    status: code === 'AI_CANCELLED' ? 'cancelled' : 'failed',
    errorCode: code,
    errorMessage: error instanceof AiOperationError ? error.detail.message : error instanceof Error ? error.message : null,
  };
}

/**
 * Append-only diagnostic log of AI generations, one JSON object per line.
 *
 * A settings-style store rewrites its whole document on every change, which
 * would mean serializing the entire history to record one run. Appending a line
 * stays constant-time however long the log gets, and the file is compacted only
 * once it drifts past the cap.
 *
 * Nothing here may throw into a generation: a failed write loses a diagnostic
 * record, which must never cost the user the result they asked for.
 */
export class AiLogStore implements AiLogRecorder {
  private lines = 0;
  private loaded = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.lines = (await this.readEntries()).length;
    this.loaded = true;
  }

  /** Records one run. Never rejects; failures are dropped on purpose. */
  append(entry: Omit<AiLogEntry, 'id' | 'at'>): void {
    const record: AiLogEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    const normalized = normalizeAiLogEntry(record);
    if (!normalized) return;
    this.pending = this.pending
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
        this.lines += 1;
        if (this.lines > MAX_AI_LOG_ENTRIES * AI_LOG_COMPACTION_SLACK) await this.compact();
      })
      .catch(() => undefined);
  }

  async list(): Promise<AiLogEntry[]> {
    await this.flush();
    return sortAiLogEntries(await this.readEntries());
  }

  async clear(): Promise<void> {
    await this.flush();
    await writeFileAtomically(this.filePath, '');
    this.lines = 0;
  }

  /** Settles queued appends so a read never races an in-flight write. */
  async flush(): Promise<void> {
    await this.pending;
  }

  private async readEntries(): Promise<AiLogEntry[]> {
    try {
      return parseAiLogLines(await readFile(this.filePath, 'utf8'));
    } catch {
      return [];
    }
  }

  /** Rewrites the file with the newest entries, replacing it atomically. */
  private async compact(): Promise<void> {
    const kept = sortAiLogEntries(await this.readEntries());
    const body = kept.map((entry) => JSON.stringify(entry)).join('\n');
    await writeFileAtomically(this.filePath, body ? `${body}\n` : '');
    this.lines = kept.length;
  }
}
