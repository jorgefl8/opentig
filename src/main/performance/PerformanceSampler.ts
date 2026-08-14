import { mkdir, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { App, ProcessMetric } from 'electron';

const SCHEMA_VERSION = 1;
const DEFAULT_INTERVAL_MS = 1_000;

interface MetricSource {
  getAppMetrics(): ProcessMetric[];
}

interface LineWriter {
  append(line: string): Promise<void>;
  close(): Promise<void>;
}

interface Clock {
  now(): Date;
  uptimeSeconds(): number;
}

interface SamplerMetadata {
  scenario: string;
  repetition: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  mainPid: number;
  hardwareAccelerationMode: 'default' | 'disabled-by-env';
}

interface PerformanceApp {
  getAppMetrics: App['getAppMetrics'];
  getPath: App['getPath'];
  getVersion: App['getVersion'];
}

interface RuntimeInfo {
  env: NodeJS.ProcessEnv;
  versions: NodeJS.ProcessVersions;
  platform: NodeJS.Platform;
  arch: string;
  pid: number;
  uptime(): number;
}

export class PerformanceSampler {
  private timer: NodeJS.Timeout | null = null;
  private sequence = 0;
  private stopped = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private writeFailureReported = false;

  constructor(
    private readonly source: MetricSource,
    private readonly writer: LineWriter,
    readonly filePath: string,
    private readonly metadata: SamplerMetadata,
    private readonly clock: Clock = systemClock,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer || this.stopped) return;
    this.enqueue({
      kind: 'metadata',
      schemaVersion: SCHEMA_VERSION,
      capturedAt: this.clock.now().toISOString(),
      intervalMs: this.intervalMs,
      memoryUnit: 'kilobytes',
      cpuUnit: 'percent',
      ...this.metadata,
    });
    this.sampleNow();
    this.timer = setInterval(() => this.sampleNow(), this.intervalMs);
    this.timer.unref();
  }

  sampleNow(): void {
    if (this.stopped) return;
    const sequence = this.sequence++;
    const capturedAt = this.clock.now().toISOString();
    const uptimeMs = Math.round(this.clock.uptimeSeconds() * 1_000);
    let metrics: ProcessMetric[];
    try {
      metrics = this.source.getAppMetrics();
    } catch (error) {
      this.enqueue({
        kind: 'sampler-error',
        schemaVersion: SCHEMA_VERSION,
        sequence,
        capturedAt,
        uptimeMs,
        scenario: this.metadata.scenario,
        repetition: this.metadata.repetition,
        operation: 'getAppMetrics',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return;
    }
    for (const metric of metrics) {
      this.enqueue({
        kind: 'process',
        schemaVersion: SCHEMA_VERSION,
        sequence,
        capturedAt,
        uptimeMs,
        scenario: this.metadata.scenario,
        repetition: this.metadata.repetition,
        pid: metric.pid,
        creationTime: metric.creationTime,
        processType: metric.type,
        name: metric.name ?? null,
        serviceName: metric.serviceName ?? null,
        sandboxed: metric.sandboxed ?? null,
        cpu: {
          percentCPUUsage: metric.cpu.percentCPUUsage,
          idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
          cumulativeCPUUsage: metric.cpu.cumulativeCPUUsage ?? null,
        },
        memoryKb: {
          workingSetSize: metric.memory.workingSetSize,
          peakWorkingSetSize: metric.memory.peakWorkingSetSize,
          privateBytes: metric.memory.privateBytes ?? null,
        },
      });
    }
  }

  mark(label: string, data: Record<string, unknown> = {}): void {
    if (this.stopped) return;
    this.enqueue({
      kind: 'marker',
      schemaVersion: SCHEMA_VERSION,
      capturedAt: this.clock.now().toISOString(),
      uptimeMs: Math.round(this.clock.uptimeSeconds() * 1_000),
      scenario: this.metadata.scenario,
      repetition: this.metadata.repetition,
      label: normalizeLabel(label, 'marker'),
      data,
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.writeQueue;
    await this.writer.close();
  }

  private enqueue(record: object): void {
    const line = `${JSON.stringify(record)}\n`;
    this.writeQueue = this.writeQueue
      .then(() => this.writer.append(line))
      .catch((error: unknown) => {
        if (this.writeFailureReported) return;
        this.writeFailureReported = true;
        console.error('JustGit performance log write failed.', error);
      });
  }
}

export async function createPerformanceSampler(
  app: PerformanceApp,
  runtime: RuntimeInfo = process,
): Promise<PerformanceSampler | null> {
  if (runtime.env.JUSTGIT_PERF_LOG !== '1') return null;

  const scenario = normalizeLabel(runtime.env.JUSTGIT_PERF_SCENARIO, 'unlabelled');
  const repetition = normalizeLabel(runtime.env.JUSTGIT_PERF_REPETITION, '1');
  const logsDirectory = app.getPath('logs');
  await mkdir(logsDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(logsDirectory, `performance-${scenario}-${repetition}-${timestamp}-${runtime.pid}.ndjson`);
  const handle = await open(filePath, 'wx', 0o600);

  return new PerformanceSampler(
    { getAppMetrics: () => app.getAppMetrics() },
    new FileHandleWriter(handle),
    filePath,
    {
      scenario,
      repetition,
      appVersion: app.getVersion(),
      electronVersion: runtime.versions.electron ?? 'unknown',
      chromeVersion: runtime.versions.chrome ?? 'unknown',
      nodeVersion: runtime.versions.node,
      platform: runtime.platform,
      arch: runtime.arch,
      mainPid: runtime.pid,
      hardwareAccelerationMode: 'default',
    },
    { now: () => new Date(), uptimeSeconds: () => runtime.uptime() },
  );
}

export function normalizeLabel(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return normalized || fallback;
}

class FileHandleWriter implements LineWriter {
  constructor(private readonly handle: FileHandle) {}

  async append(line: string): Promise<void> {
    await this.handle.appendFile(line, 'utf8');
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

const systemClock: Clock = {
  now: () => new Date(),
  uptimeSeconds: () => process.uptime(),
};
