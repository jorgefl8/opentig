import type { BrowserWindow } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { PerformanceSampler } from './PerformanceSampler';
import { normalizeLabel } from './PerformanceSampler';

const MAX_STEPS = 100;
const MAX_DURATION_MS = 10 * 60_000;

export interface PerformanceAutomationStep {
  atMs: number;
  settleMs: number;
  label: string;
  action: Record<string, unknown>;
}

export function parsePerformanceAutomationSteps(value: string | undefined): PerformanceAutomationStep[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_STEPS) return [];
  const steps: PerformanceAutomationStep[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const atMs = Number(record.atMs);
    const settleMs = record.settleMs === undefined ? 1_500 : Number(record.settleMs);
    if (!Number.isFinite(atMs) || atMs < 0 || atMs > MAX_DURATION_MS
      || !Number.isFinite(settleMs) || settleMs < 0 || settleMs > 60_000
      || !record.action || typeof record.action !== 'object' || Array.isArray(record.action)) {
      return [];
    }
    steps.push({
      atMs: Math.round(atMs),
      settleMs: Math.round(settleMs),
      label: normalizeLabel(typeof record.label === 'string' ? record.label : undefined, `step-${steps.length + 1}`),
      action: record.action as Record<string, unknown>,
    });
  }
  return steps.sort((left, right) => left.atMs - right.atMs);
}

export function startPerformanceAutomation(
  window: BrowserWindow,
  sampler: PerformanceSampler | null,
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  if (env.JUSTGIT_PERF_AUTOMATION !== '1') return () => undefined;
  const steps = parsePerformanceAutomationSteps(env.JUSTGIT_PERF_ACTIONS);
  const timers: NodeJS.Timeout[] = [];

  for (const step of steps) {
    timers.push(setTimeout(() => {
      if (window.isDestroyed()) return;
      sampler?.mark(`${step.label}-before`);
      sampler?.sampleNow();
      if (step.action.type === 'heap-snapshot') {
        const directory = env.JUSTGIT_PERF_SNAPSHOT_DIR;
        if (!directory || !path.isAbsolute(directory)) {
          sampler?.mark(`${step.label}-after`, { snapshotUnavailable: true });
          return;
        }
        void mkdir(directory, { recursive: true })
          .then(() => window.webContents.takeHeapSnapshot(path.join(directory, `${step.label}.heapsnapshot`)))
          .then(() => sampler?.mark(`${step.label}-after`, { snapshotCreated: true }))
          .catch(() => sampler?.mark(`${step.label}-after`, { snapshotUnavailable: true }));
        return;
      }
      const actionJson = JSON.stringify(step.action);
      void window.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('justgit:performance-action',{detail:${actionJson}}))`,
        true,
      ).then(() => {
        timers.push(setTimeout(() => {
          if (window.isDestroyed()) return;
          void collectRendererDiagnostics(window).then((diagnostics) => {
            sampler?.sampleNow();
            sampler?.mark(`${step.label}-after`, diagnostics);
          });
        }, step.settleMs));
      });
    }, step.atMs));
  }

  const exitMs = Number(env.JUSTGIT_PERF_EXIT_MS);
  if (Number.isFinite(exitMs) && exitMs > 0 && exitMs <= MAX_DURATION_MS) {
    timers.push(setTimeout(() => {
      if (!window.isDestroyed()) window.close();
    }, exitMs));
  }

  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.length = 0;
  };
}

async function collectRendererDiagnostics(window: BrowserWindow): Promise<Record<string, unknown>> {
  try {
    return await window.webContents.executeJavaScript(`(() => {
      const memory = performance.memory;
      const results = Array.isArray(window.__justgitPerformanceResults)
        ? window.__justgitPerformanceResults.splice(0)
        : [];
      const grammarChunks = performance.getEntriesByType('resource')
        .map((entry) => String(entry.name).split('/').pop() ?? '')
        .filter((name) => /^(html|js|ts|tsx|css|json|bash|markdown|python|yaml|go|dockerfile|sql|rust|java|xml)-/.test(name));
      return {
        usedJSHeapMiB: memory && Number.isFinite(memory.usedJSHeapSize)
          ? Math.round(memory.usedJSHeapSize / 1048576 * 100) / 100
          : null,
        results,
        grammarChunks: [...new Set(grammarChunks)],
      };
    })()`, true) as Record<string, unknown>;
  } catch {
    return { diagnosticUnavailable: true };
  }
}
