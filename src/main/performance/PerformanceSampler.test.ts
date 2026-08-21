import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProcessMetric } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPerformanceSampler, normalizeLabel, PerformanceSampler } from './PerformanceSampler';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
});

describe('PerformanceSampler', () => {
  it('writes metadata and one sanitized process record without repository data', async () => {
    const lines: string[] = [];
    const writer = {
      append: vi.fn(async (line: string) => { lines.push(line); }),
      close: vi.fn(async () => undefined),
    };
    const sampler = new PerformanceSampler(
      { getAppMetrics: () => [metric()] },
      writer,
      'performance.ndjson',
      {
        scenario: 'repo-idle',
        repetition: '2',
        appVersion: '1.0.0',
        electronVersion: '43.1.1',
        chromeVersion: '144.0.0',
        nodeVersion: '24.0.0',
        platform: 'win32',
        arch: 'x64',
        mainPid: 100,
        hardwareAccelerationMode: 'default',
      },
      {
        now: () => new Date('2026-07-24T10:00:00.000Z'),
        uptimeSeconds: () => 12.5,
      },
      60_000,
    );

    sampler.start();
    await sampler.stop();

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      kind: 'metadata',
      schemaVersion: 1,
      scenario: 'repo-idle',
      memoryUnit: 'kilobytes',
    });
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({
      kind: 'process',
      sequence: 0,
      uptimeMs: 12_500,
      pid: 101,
      processType: 'Tab',
      cpu: { percentCPUUsage: 1.5 },
      memoryKb: { workingSetSize: 2_048, privateBytes: 1_024 },
    });
    expect(lines.join('')).not.toContain('repository');
    expect(writer.close).toHaveBeenCalledOnce();
  });

  it('stays fully disabled unless the opt-in env var is exactly 1', async () => {
    const getPath = vi.fn(() => {
      throw new Error('must not inspect the filesystem');
    });
    const sampler = await createPerformanceSampler(
      { getAppMetrics: () => [], getPath, getVersion: () => '1.0.0' },
      runtime({ OPENTIG_PERF_LOG: 'true' }),
    );
    expect(sampler).toBeNull();
    expect(getPath).not.toHaveBeenCalled();
  });

  it('records metric-source failures without throwing into the application', async () => {
    const lines: string[] = [];
    const sampler = new PerformanceSampler(
      { getAppMetrics: () => { throw new TypeError('transient'); } },
      {
        append: async (line) => { lines.push(line); },
        close: async () => undefined,
      },
      'performance.ndjson',
      {
        scenario: 'shutdown',
        repetition: '1',
        appVersion: '1.0.0',
        electronVersion: '43.1.1',
        chromeVersion: '144.0.0',
        nodeVersion: '24.0.0',
        platform: 'win32',
        arch: 'x64',
        mainPid: 100,
        hardwareAccelerationMode: 'default',
      },
      {
        now: () => new Date('2026-07-24T10:00:00.000Z'),
        uptimeSeconds: () => 12.5,
      },
      60_000,
    );

    expect(() => sampler.start()).not.toThrow();
    await sampler.stop();

    expect(JSON.parse(lines[1] ?? '')).toMatchObject({
      kind: 'sampler-error',
      operation: 'getAppMetrics',
      errorType: 'TypeError',
    });
    expect(lines.join('')).not.toContain('transient');
  });

  it('records bounded diagnostic markers without mixing them into process rows', async () => {
    const lines: string[] = [];
    const sampler = new PerformanceSampler(
      { getAppMetrics: () => [] },
      {
        append: async (line) => { lines.push(line); },
        close: async () => undefined,
      },
      'performance.ndjson',
      {
        scenario: 'markdown',
        repetition: '1',
        appVersion: '1.0.0',
        electronVersion: '43.1.1',
        chromeVersion: '144.0.0',
        nodeVersion: '24.0.0',
        platform: 'win32',
        arch: 'x64',
        mainPid: 100,
        hardwareAccelerationMode: 'default',
      },
      {
        now: () => new Date('2026-07-24T10:00:00.000Z'),
        uptimeSeconds: () => 12.5,
      },
    );

    sampler.mark(' Markdown / Cold ', { durationMs: 12.25 });
    await sampler.stop();

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      kind: 'marker',
      uptimeMs: 12_500,
      label: 'markdown-cold',
      data: { durationMs: 12.25 },
    });
  });

  it('creates a private NDJSON log with normalized labels when enabled', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'justgit-performance-'));
    temporaryDirectories.push(directory);
    const sampler = await createPerformanceSampler(
      {
        getAppMetrics: () => [metric()],
        getPath: () => directory,
        getVersion: () => '1.0.0',
      },
      runtime({
        OPENTIG_PERF_LOG: '1',
        OPENTIG_PERF_SCENARIO: ' Repo / Idle ',
        OPENTIG_PERF_REPETITION: '#3',
      }),
    );

    expect(sampler).not.toBeNull();
    sampler?.start();
    await sampler?.stop();

    expect(path.basename(sampler?.filePath ?? '')).toMatch(/^performance-repo-idle-3-/);
    const records = (await readFile(sampler?.filePath ?? '', 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { kind: string });
    expect(records.map((record) => record.kind)).toEqual(['metadata', 'process']);
  });
});

describe('normalizeLabel', () => {
  it('keeps only bounded filename-safe labels', () => {
    expect(normalizeLabel(' Diff LARGE / Windows ', 'fallback')).toBe('diff-large-windows');
    expect(normalizeLabel('***', 'fallback')).toBe('fallback');
    expect(normalizeLabel('a'.repeat(100), 'fallback')).toHaveLength(64);
  });
});

function metric(): ProcessMetric {
  return {
    pid: 101,
    type: 'Tab',
    creationTime: 1_721_812_800_000,
    name: 'Tab',
    sandboxed: true,
    cpu: {
      percentCPUUsage: 1.5,
      idleWakeupsPerSecond: 0,
      cumulativeCPUUsage: 2.5,
    },
    memory: {
      workingSetSize: 2_048,
      peakWorkingSetSize: 4_096,
      privateBytes: 1_024,
    },
  };
}

function runtime(env: NodeJS.ProcessEnv): NodeJS.Process & { env: NodeJS.ProcessEnv } {
  return {
    env,
    versions: { ...process.versions, electron: '43.1.1', chrome: '144.0.0' },
    platform: 'win32',
    arch: 'x64',
    pid: 100,
    uptime: () => 12.5,
  } as NodeJS.Process & { env: NodeJS.ProcessEnv };
}
