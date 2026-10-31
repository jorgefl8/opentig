// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RepositoryWorkflowList } from '@shared/contracts';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { RunWorkflowDialog } from './RunWorkflowDialog';

const api = vi.hoisted(() => ({ listWorkflows: vi.fn(), listWorkflowRuns: vi.fn(), runWorkflow: vi.fn(), repositoryAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('sileo', () => ({ sileo: toast }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogPopup: ({ children }: { children: ReactNode }) => createElement('div', { role: 'dialog' }, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
}));

const list: RepositoryWorkflowList = { defaultBranch: 'main', viewerCanWrite: true, workflows: [{ id: 1, name: 'Prepare release', path: '.github/workflows/prepare-release.yml' }, { id: 2, name: 'CI', path: '.github/workflows/ci.yml' }] };
const onClose = vi.fn();
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 3 });
  api.listWorkflows.mockResolvedValue(list);
  api.listWorkflowRuns.mockResolvedValue([{ databaseId: 1, status: 'completed', conclusion: 'success', url: 'https://github.com/sample/demo/actions/runs/1', createdAt: '2026-01-01T00:00:00Z', displayTitle: 'Prepare release run' }]);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 }, mutations: { networkMode: 'always', retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 6; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RunWorkflowDialog, { repositoryId: 'repo', onClose }))));
  await settle();
}
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
const click = async (label: string) => { await act(async () => button(label)!.click()); await settle(); };

it('starts on the first workflow and shows its latest runs', async () => {
  await render();
  expect(container.querySelector('.workflow-row[aria-pressed="true"] strong')?.textContent).toBe('Prepare release');
  expect(api.listWorkflowRuns).toHaveBeenCalledWith('repo', '.github/workflows/prepare-release.yml');
  expect(container.querySelector('.workflow-run')?.textContent).toContain('Prepare release run');
});

it('names the workflow and branch before running on the default branch', async () => {
  api.runWorkflow.mockResolvedValue(undefined);
  await render();
  await click('Run workflow');
  expect(api.runWorkflow).not.toHaveBeenCalled();
  const panel = container.querySelector('.pr-action-panel')!.textContent;
  expect(panel).toContain('Prepare release');
  expect(panel).toContain('main');
  expect(panel).toContain('as @sample');
  expect(panel).toContain('commits, tags and publications');
  await click('Run Prepare release');
  expect(api.runWorkflow).toHaveBeenCalledWith({ repositoryId: 'repo', path: '.github/workflows/prepare-release.yml', ref: 'main', expectedAccount: { login: 'sample', revision: 3 } });
  expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Workflow started' }));
});

it('switches workflow and withdraws the question', async () => {
  await render();
  await click('Run workflow');
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.workflow-row')][1]!.click());
  await settle();
  expect(container.querySelector('.pr-action-panel')).toBeNull();
  expect(api.listWorkflowRuns).toHaveBeenLastCalledWith('repo', '.github/workflows/ci.yml');
});

it('shows GitHub\'s reason when a workflow cannot start', async () => {
  api.runWorkflow.mockRejectedValue(Object.assign(new Error('no'), { detail: { code: 'GH_PROCESS_FAILED', operation: 'gh-workflow-run', message: "Workflow does not have 'workflow_dispatch' trigger" } }));
  await render();
  await click('Run workflow');
  await click('Run Prepare release');
  expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ description: "Workflow does not have 'workflow_dispatch' trigger" }));
});

it('holds running back after no answer, until the runs have been read again', async () => {
  api.runWorkflow.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
  await render();
  await click('Run workflow');
  await click('Run Prepare release');
  expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have started') }));
  expect(button('Run workflow')?.disabled).toBe(true);
  await click('Refresh runs');
  expect(button('Run workflow')?.disabled).toBe(false);
});

it('keeps holding back when the runs could not be read', async () => {
  api.runWorkflow.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
  await render();
  await click('Run workflow');
  await click('Run Prepare release');
  api.listWorkflowRuns.mockRejectedValue(new Error('offline'));
  await click('Refresh runs');
  expect(button('Run workflow')?.disabled).toBe(true);
});

it('offers no run without write access', async () => {
  api.listWorkflows.mockResolvedValue({ ...list, viewerCanWrite: false });
  await render();
  expect(button('Run workflow')?.disabled).toBe(true);
  expect(container.textContent).toContain('requires write access');
});

it('says when there is nothing to run', async () => {
  api.listWorkflows.mockResolvedValue({ ...list, workflows: [] });
  await render();
  expect(container.textContent).toContain('no active workflows');
  expect(button('Run workflow')?.disabled).toBe(true);
});
