// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActionRunDetails, ActionRunSummary } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActionsView } from './ActionsView';
import { WorkflowRunViewer } from './WorkflowRunViewer';

const api = vi.hoisted(() => ({ listActionRuns: vi.fn(), getActionRun: vi.fn(), listWorkflows: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));

const summary: ActionRunSummary = {
  id: 42, number: 340, attempt: 1, title: 'fix: links', workflowId: 7, workflowName: 'CI', status: 'completed', conclusion: 'failure',
  event: 'push', branch: 'main', headSha: 'a'.repeat(40), url: 'https://github.com/sample/demo/actions/runs/42',
  createdAt: '2026-11-05T13:00:00Z', startedAt: '2026-11-05T13:00:00Z', updatedAt: '2026-11-05T13:03:05Z',
};
const step = (number: number, name: string, conclusion: string) => ({ number, name, status: 'completed', conclusion, startedAt: '2026-11-05T13:00:10Z', completedAt: '2026-11-05T13:00:20Z' });
const job = (id: number, name: string, conclusion: string) => ({
  id, name, status: 'completed', conclusion, startedAt: '2026-11-05T13:00:05Z', completedAt: '2026-11-05T13:01:05Z',
  url: `https://github.com/sample/demo/actions/runs/42/job/${id}`, runnerName: 'runner', steps: [step(1, 'Set up job', 'success'), step(2, 'Run tests', conclusion)],
});
const details: ActionRunDetails = {
  ...summary, path: '.github/workflows/ci.yml', actor: 'sample', jobsTruncated: false, graphSource: 'workflow',
  jobs: [job(1, 'changes', 'success'), job(2, 'validate (linux)', 'success'), job(3, 'validate (windows)', 'failure')],
  graph: [
    { id: 'changes', name: 'changes', needs: [], jobIds: [1] },
    { id: 'validate', name: 'validate', needs: ['changes'], jobIds: [2, 3] },
    { id: 'deploy', name: 'deploy', needs: ['validate'], jobIds: [] },
  ],
};

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  api.listActionRuns.mockResolvedValue([summary, { ...summary, id: 43, number: 341, status: 'in_progress', conclusion: null, title: 'feat: canvas' }]);
  api.getActionRun.mockResolvedValue(details);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function render(element: ReactElement) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, element))));
  for (let tick = 0; tick < 6; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

it('lists workflow runs with their state and opens one', async () => {
  const onSelect = vi.fn();
  await render(createElement(ActionsView, { repositoryId: 'repo', workflowId: 7, activeRunId: 42, onSelect }));
  expect(api.listActionRuns).toHaveBeenCalledWith('repo', 7);
  const rows = [...container.querySelectorAll<HTMLButtonElement>('.action-run-row')];
  expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['fix: links, CI #340, Failed', 'feat: canvas, CI #341, In progress']);
  expect(rows[0]!.textContent).toContain('CI #340 · 3m 05s');
  expect(container.querySelector('.pull-item.active')?.textContent).toContain('fix: links');
  await act(async () => rows[1]!.click());
  expect(onSelect).toHaveBeenCalledWith(43);
});

it('draws the run as a graph and shows the steps of the job chosen in it', async () => {
  await render(createElement(WorkflowRunViewer, { repositoryId: 'repo', runId: 42 }));
  expect(api.getActionRun).toHaveBeenCalledWith('repo', 42);
  expect(container.querySelector('.pr-viewer-status')?.textContent).toContain('Failed · 1 job failed');
  const nodes = [...container.querySelectorAll('.workflow-node')];
  expect(nodes.map((node) => node.getAttribute('aria-label'))).toEqual(['changes: Succeeded', 'validate: 2 of 2 jobs done', 'deploy: Not run']);
  expect(nodes[1]!.classList).toContain('tone-failure');
  expect(container.querySelectorAll('.workflow-edge')).toHaveLength(2);
  const matrixJobs = [...nodes[1]!.querySelectorAll<HTMLButtonElement>('.workflow-job')];
  expect(matrixJobs.map((button) => button.querySelector('.workflow-job-name')?.textContent)).toEqual(['linux', 'windows']);

  await act(async () => matrixJobs[1]!.click());
  const panel = container.querySelector('.workflow-job-panel')!;
  expect(panel.querySelector('h3')?.textContent).toBe('validate (windows)');
  expect([...panel.querySelectorAll('.workflow-step')].map((item) => item.className)).toEqual(['workflow-step tone-success', 'workflow-step tone-failure']);
  expect(matrixJobs[1]!.getAttribute('aria-pressed')).toBe('true');

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close job"]')!.click());
  expect(container.querySelector('.workflow-job-panel')).toBeNull();
});

it('opens at the job a link points to', async () => {
  await render(createElement(WorkflowRunViewer, { repositoryId: 'repo', runId: 42, jobId: 1 }));
  expect(container.querySelector('.workflow-job-panel h3')?.textContent).toBe('changes');
  expect(container.querySelector('.workflow-node-header[aria-pressed="true"]')?.textContent).toContain('changes');
});
