// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionJobLog, ActionRunJob } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { JobLogView } from './JobLogView';

const getActionJobLog = vi.hoisted(() => vi.fn<(repositoryId: string, jobId: number) => Promise<ActionJobLog>>());
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: { getActionJobLog } } }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

const step = (number: number, name: string, conclusion: string) => ({ number, name, status: 'completed', conclusion, startedAt: '2026-11-13T21:57:38Z', completedAt: '2026-11-13T21:57:39Z' });
const job = (overrides: Partial<ActionRunJob> = {}): ActionRunJob => ({
  id: 77, name: 'validate (ubuntu)', status: 'completed', conclusion: 'failure', startedAt: '2026-11-13T21:57:38Z', completedAt: '2026-11-13T21:58:00Z',
  url: 'https://github.com/example/demo/actions/runs/5/job/77', runnerName: 'runner',
  steps: [step(1, 'Set up job', 'success'), step(2, 'Run pnpm test', 'failure')], ...overrides,
});
const line = (number: number, kind: 'output' | 'error' | 'group' | 'endgroup', text: string) => ({ number, time: 1_794_607_058_000, kind, text });
const log: ActionJobLog = {
  state: 'ready', jobId: 77, totalLines: 6, readCut: false, displayCut: false,
  steps: [
    { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', omittedLines: 0, lines: [line(1, 'output', 'Current runner version')] },
    { number: 2, name: 'Run pnpm test', status: 'completed', conclusion: 'failure', omittedLines: 0, lines: [
      line(1, 'group', 'Run pnpm test'), line(2, 'output', 'pnpm test'), line(3, 'endgroup', ''),
      line(4, 'output', '\x1b[31mFAIL\x1b[0m src/a.test.ts'),
      line(5, 'error', '<img src=x onerror="window.hacked=1">Expected 2, received 3'),
    ] },
  ],
};

function height(element: HTMLElement): number {
  if (element.classList.contains('job-log-body')) return 400;
  if (element.classList.contains('virtual-row')) return 20;
  return 0;
}

beforeEach(() => {
  getActionJobLog.mockReset().mockResolvedValue(log);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mount(props: Parameters<typeof JobLogView>[0]) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(JobLogView, props)))));
  for (let tick = 0; tick < 3; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("a job's log in the run viewer", () => {
  it('opens on the failed step at its error, with the text of the log shown as text', async () => {
    await mount({ repositoryId: 'repo', job: job(), now: Date.now(), onBack: vi.fn() });
    const steps = [...container.querySelectorAll('.job-log-step-toggle')];
    expect(steps.map((button) => [button.textContent, button.getAttribute('aria-expanded')])).toEqual([
      ['Set up job', 'false'], ['Run pnpm test1 error', 'true'],
    ]);
    const error = container.querySelector('.job-log-line.kind-error');
    expect(error?.textContent).toContain('<img src=x onerror="window.hacked=1">Expected 2, received 3');
    expect(error?.classList.contains('current')).toBe(true);
    expect(container.querySelector('img, script')).toBeNull();
    expect((window as { hacked?: number }).hacked).toBeUndefined();
    // Colors are classes of the theme's palette around plain text.
    expect(container.querySelector('.ansi-fg-1')?.textContent).toBe('FAIL');
    // The step's command group starts folded.
    expect(container.querySelector('.job-log-group')?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('pnpm test\n');
  });

  it('waits for a running job to finish, then reads its log', async () => {
    const onBack = vi.fn();
    await mount({ repositoryId: 'repo', job: job({ status: 'in_progress', conclusion: null, completedAt: null }), now: Date.now(), onBack });
    expect(container.textContent).toContain('This job is still running');
    expect(getActionJobLog).not.toHaveBeenCalled();
    await mount({ repositoryId: 'repo', job: job(), now: Date.now(), onBack });
    expect(getActionJobLog).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.job-log-line.kind-error')).not.toBeNull();
  });
});
