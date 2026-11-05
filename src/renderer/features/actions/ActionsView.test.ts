// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActionRunDetails, ActionRunSummary } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RepositoryLinksContext } from '@/components/repository-links';
import { ActionsTools, ActionsView } from './ActionsView';
import { WorkflowRunViewer } from './WorkflowRunViewer';

const api = vi.hoisted(() => ({ listActionRuns: vi.fn(), getActionRun: vi.fn(), listWorkflows: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('motion/react', async (original) => ({ ...await original<typeof import('motion/react')>(), useReducedMotion: () => true }));
// The dialog's own behaviour is tested on its own; here it only reports that GitHub accepted a run.
vi.mock('./RunWorkflowDialog', () => ({
  RunWorkflowDialog: ({ onStarted }: { onStarted(workflow: { id: number; name: string; path: string }): void }) => createElement('button', {
    'data-testid': 'start', onClick: () => onStarted({ id: 9, name: 'Deploy website', path: '.github/workflows/website.yml' }),
  }),
}));

const summary: ActionRunSummary = {
  id: 42, number: 340, attempt: 1, title: 'fix: links', workflowId: 7, workflowName: 'CI', status: 'completed', conclusion: 'failure',
  event: 'push', branch: 'main', headSha: 'a'.repeat(40), url: 'https://github.com/sample/demo/actions/runs/42',
  createdAt: '2026-11-05T13:00:00Z', startedAt: '2026-11-05T13:00:00Z', updatedAt: '2026-11-05T13:03:05Z',
  actor: { login: 'sample', avatarUrl: null }, pullRequestNumber: null,
};
const step = (number: number, name: string, conclusion: string) => ({ number, name, status: 'completed', conclusion, startedAt: '2026-11-05T13:00:10Z', completedAt: '2026-11-05T13:00:20Z' });
const job = (id: number, name: string, conclusion: string) => ({
  id, name, status: 'completed', conclusion, startedAt: '2026-11-05T13:00:05Z', completedAt: '2026-11-05T13:01:05Z',
  url: `https://github.com/sample/demo/actions/runs/42/job/${id}`, runnerName: 'runner', steps: [step(1, 'Set up job', 'success'), step(2, 'Run tests', conclusion)],
});
const details: ActionRunDetails = {
  ...summary, path: '.github/workflows/ci.yml', jobsTruncated: false, graphSource: 'workflow',
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
  api.listActionRuns.mockResolvedValue({ runs: [summary, { ...summary, id: 43, number: 341, status: 'in_progress', conclusion: null, title: 'feat: canvas' }], hasMore: false });
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
  expect(api.listActionRuns).toHaveBeenCalledWith('repo', 7, 1);
  expect(container.querySelector('.actions-more')).toBeNull();
  const rows = [...container.querySelectorAll<HTMLButtonElement>('.action-run-open')];
  expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['fix: links, CI #340, Failed, started by sample', 'feat: canvas, CI #341, In progress, started by sample']);
  const first = container.querySelector('.action-run-item')!;
  expect(first.querySelector('.action-run-workflow')?.textContent).toBe('CI');
  expect(first.querySelector('.action-run-ref')?.textContent).toBe('aaaaaaa');
  expect(first.querySelector('.action-run-by')?.textContent).toBe('by sample');
  expect(first.querySelector('.action-run-duration')?.textContent).toBe('3m 05s');
  expect(first.querySelector('.action-run-badge .action-failure')).not.toBeNull();
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
  await act(async () => { await vi.waitFor(() => expect(container.querySelector('.workflow-job-panel')).toBeNull()); });
});

it('opens at the job a link points to', async () => {
  await render(createElement(WorkflowRunViewer, { repositoryId: 'repo', runId: 42, jobId: 1 }));
  expect(container.querySelector('.workflow-job-panel h3')?.textContent).toBe('changes');
  expect(container.querySelector('.workflow-node-header[aria-pressed="true"]')?.textContent).toContain('changes');
});

it('opens the run of a workflow started from OpenTig once GitHub lists it', async () => {
  const onSelect = vi.fn();
  const onWorkflowChange = vi.fn();
  api.listWorkflows.mockResolvedValue({ workflows: [], defaultBranch: 'main', viewerCanWrite: true });
  await render(createElement(ActionsTools, { repositoryId: 'repo', nameWithOwner: 'sample/demo', account: null, onOpenGitHubSettings: vi.fn(), workflowId: 7, onWorkflowChange, onSelect }));
  const started = { ...summary, id: 99, workflowId: 9, event: 'workflow_dispatch', status: 'queued', conclusion: null, createdAt: new Date().toISOString() };
  api.listActionRuns.mockImplementation(async (_repository: string, workflowId: number | null) => ({ runs: workflowId === 9 ? [started, { ...summary, workflowId: 9 }] : [summary], hasMore: false }));

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Run a workflow"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="start"]')!.click());
  for (let tick = 0; tick < 6; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

  expect(api.listActionRuns).toHaveBeenCalledWith('repo', 9, 1);
  expect(onWorkflowChange).toHaveBeenCalledWith(9);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(99);
  expect(container.querySelector('[aria-label="Run a workflow"]')).not.toBeNull();
});

it('loads older runs a page at a time, like History', async () => {
  const page = (from: number) => Array.from({ length: 2 }, (_, index) => ({ ...summary, id: from + index, number: from + index, title: `run ${from + index}` }));
  api.listActionRuns.mockImplementation(async (_repository: string, _workflow: number | null, number: number) => ({ runs: page(number * 10), hasMore: number < 2 }));
  await render(createElement(ActionsView, { repositoryId: 'repo', workflowId: null, activeRunId: null, onSelect: vi.fn() }));
  expect(container.querySelectorAll('.action-run-item')).toHaveLength(2);
  const more = container.querySelector<HTMLButtonElement>('.actions-more')!;
  expect(more.textContent).toBe('Load more');
  await act(async () => more.click());
  for (let tick = 0; tick < 6; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(api.listActionRuns).toHaveBeenLastCalledWith('repo', null, 2);
  expect([...container.querySelectorAll('.action-run-item')].map((row) => row.querySelector('.pull-title')?.textContent)).toEqual(['run 10', 'run 11', 'run 20', 'run 21']);
  expect(container.querySelector('.actions-more')).toBeNull();
});

it('offers OpenTig or GitHub for what started a run, without opening the run', async () => {
  const onSelect = vi.fn();
  const open = vi.fn();
  api.listActionRuns.mockResolvedValue({ runs: [
    { ...summary, event: 'pull_request', pullRequestNumber: 77, actor: { login: 'dependabot[bot]', avatarUrl: null } },
    { ...summary, id: 44, event: 'release', branch: 'v0.2.9' },
    { ...summary, id: 45, event: 'schedule', actor: { login: 'github-actions[bot]', avatarUrl: null } },
  ], hasMore: false });
  await render(createElement(RepositoryLinksContext.Provider, { value: { nameWithOwner: 'sample/demo', open } },
    createElement(ActionsView, { repositoryId: 'repo', workflowId: null, activeRunId: null, onSelect })));
  const items = [...container.querySelectorAll('.action-run-item')];
  expect(items.map((item) => item.querySelector('.action-run-ref')?.textContent)).toEqual(['#77', 'v0.2.9', 'main']);
  expect(items[2]!.querySelector('.action-run-ref')?.tagName).toBe('SPAN');
  expect(items[2]!.querySelector('.action-run-by')).toBeNull();

  await act(async () => items[0]!.querySelector<HTMLButtonElement>('button.action-run-ref')!.click());
  for (let tick = 0; tick < 4; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const openHere = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes('Open in OpenTig'))!;
  expect(document.body.textContent).toContain('CI #340 ran for this pull request.');
  await act(async () => openHere.click());
  expect(open).toHaveBeenCalledWith({ kind: 'pull', number: 77 });
  expect(onSelect).not.toHaveBeenCalled();
});
