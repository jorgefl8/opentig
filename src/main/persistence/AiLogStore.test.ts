import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_LOG_COMPACTION_SLACK, EMPTY_AI_USAGE, MAX_AI_LOG_ENTRIES } from '../../shared/ai-log';
import { AiLogStore } from './AiLogStore';

const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

function entry(overrides: Partial<Parameters<AiLogStore['append']>[0]> = {}) {
  return {
    operation: 'commit-message' as const,
    harness: 'claude' as const,
    model: 'default',
    repositoryId: '0123456789abcdef',
    status: 'success' as const,
    durationMs: 1200,
    errorCode: null,
    usage: { ...EMPTY_AI_USAGE, inputTokens: 10, outputTokens: 2, costUsd: 0.01 },
    stagedFileCount: 3,
    contextTruncated: false,
    splitOffered: true,
    splitGroups: 2,
    splitRejectedReason: null,
    splitBlockedReason: null,
    ...overrides,
  };
}

async function store(): Promise<AiLogStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'justgit-ailog-'));
  directories.push(directory);
  const created = new AiLogStore(path.join(directory, 'ai-log.jsonl'));
  await created.load();
  return created;
}

describe('AiLogStore', () => {
  it('appends runs and returns them newest first', async () => {
    const log = await store();
    log.append(entry({ model: 'first' }));
    log.append(entry({ model: 'second', status: 'failed', errorCode: 'AI_RATE_LIMITED' }));

    const entries = await log.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.model).toBe('second');
    expect(entries[0]).toMatchObject({ status: 'failed', errorCode: 'AI_RATE_LIMITED' });
    expect(entries[1]?.usage).toMatchObject({ inputTokens: 10, costUsd: 0.01 });
    expect(entries.every((item) => /^[0-9a-f-]{36}$/.test(item.id))).toBe(true);
  });

  it('never stores the prompt or any repository content', async () => {
    const log = await store();
    log.append({ ...entry(), extra: 'diff --git a/secret.ts' } as never);
    await log.flush();
    const raw = await readFile((log as unknown as { filePath: string }).filePath, 'utf8');
    expect(raw).not.toContain('diff --git');
    expect(raw).not.toContain('extra');
  });

  it('drops unreadable lines instead of failing the whole read', async () => {
    const log = await store();
    log.append(entry());
    await log.flush();
    const file = (log as unknown as { filePath: string }).filePath;
    await writeFile(file, `${await readFile(file, 'utf8')}not json\n{"id":"x"}\n\n`, 'utf8');
    expect(await log.list()).toHaveLength(1);
  });

  it('repairs invalid optional fields in an otherwise valid legacy entry', async () => {
    const log = await store();
    const file = (log as unknown as { filePath: string }).filePath;
    await writeFile(file, `${JSON.stringify({
      id: 'legacy-entry', at: '2026-08-17T00:00:00.000Z', operation: 'commit-message', harness: 'codex', status: 'success',
      model: 42, repositoryId: null, durationMs: -1, usage: { inputTokens: 4.4, outputTokens: 'unknown' }, extra: 'ignored',
    })}\n`, 'utf8');
    const entries = await log.list();
    expect(entries[0]).toMatchObject({ model: 'default', repositoryId: '', durationMs: 0, usage: { inputTokens: 4, outputTokens: null } });
  });

  it('compacts to the newest entries once it drifts past the cap', async () => {
    const log = await store();
    for (let index = 0; index < MAX_AI_LOG_ENTRIES + 200; index += 1) log.append(entry({ durationMs: index }));

    const entries = await log.list();
    expect(entries).toHaveLength(MAX_AI_LOG_ENTRIES);
    // Compaction is deliberately lazy, so the file rides between the cap and the
    // slack rather than being rewritten on every single append.
    const file = (log as unknown as { filePath: string }).filePath;
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(Math.ceil(MAX_AI_LOG_ENTRIES * AI_LOG_COMPACTION_SLACK));
    // The oldest runs are the ones dropped, even though every entry in this test
    // shares a timestamp.
    expect(Math.min(...entries.map((item) => item.durationMs))).toBeGreaterThan(0);
    expect(entries[0]?.durationMs).toBeGreaterThan(entries[entries.length - 1]!.durationMs);
  });

  it('survives an unwritable path without throwing at the caller', async () => {
    const log = new AiLogStore(path.join(os.tmpdir(), 'justgit-missing', '\0invalid', 'ai-log.jsonl'));
    await log.load();
    expect(() => log.append(entry())).not.toThrow();
    await expect(log.flush()).resolves.toBeUndefined();
    expect(await log.list()).toEqual([]);
  });

  it('clears the history on request', async () => {
    const log = await store();
    log.append(entry());
    await log.clear();
    expect(await log.list()).toEqual([]);
  });
});
