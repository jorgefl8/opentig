import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PROBLEM_LOG_ENTRIES, PROBLEM_LOG_COMPACTION_SLACK } from '../../shared/problems-log';
import { ProblemsLogStore, recordProblemSafely } from './ProblemsLogStore';

const directories: string[] = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))));

async function store(): Promise<{ log: ProblemsLogStore; file: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-problems-'));
  directories.push(directory);
  const file = path.join(directory, 'problems.jsonl');
  const log = new ProblemsLogStore(file);
  await log.load();
  return { log, file };
}

function entry(overrides: Partial<Parameters<ProblemsLogStore['record']>[0]> = {}) {
  return {
    source: 'command' as const,
    operation: 'pull',
    code: 'TIMEOUT',
    message: 'Could not pull changes.',
    ...overrides,
  };
}

describe('ProblemsLogStore', () => {
  it('appends problems newest first and skips unreadable lines', async () => {
    const { log, file } = await store();
    log.record(entry({ operation: 'first' }));
    await log.flush();
    await writeFile(file, `${await readFile(file, 'utf8')}{broken\n`);
    log.record(entry({ operation: 'second', code: 'UNKNOWN' }));
    const entries = await log.list();
    expect(entries.map((item) => item.operation)).toEqual(['second', 'first']);
  });

  it('swallows recorder failures', () => {
    expect(() => recordProblemSafely({ record: () => { throw new Error('disk'); } }, entry())).not.toThrow();
    expect(() => recordProblemSafely(undefined, entry())).not.toThrow();
  });

  it('compacts to the newest entries once it drifts past the cap', async () => {
    const { log } = await store();
    const extra = Math.ceil(MAX_PROBLEM_LOG_ENTRIES * PROBLEM_LOG_COMPACTION_SLACK) - MAX_PROBLEM_LOG_ENTRIES + 2;
    for (let index = 0; index < MAX_PROBLEM_LOG_ENTRIES + extra; index += 1) {
      log.record(entry({ operation: `op-${index}` }));
    }
    const entries = await log.list();
    expect(entries.length).toBe(MAX_PROBLEM_LOG_ENTRIES);
  });
});
