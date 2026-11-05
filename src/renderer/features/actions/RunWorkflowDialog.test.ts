// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActionRunSummary, RunnableWorkflowList } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { RunWorkflowDialog } from './RunWorkflowDialog';

const api = vi.hoisted(() => ({ listRunnableWorkflows: vi.fn(), getWorkflowTriggers: vi.fn(), listActionRuns: vi.fn(), runWorkflow: vi.fn(), repositoryAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('sileo', () => ({ sileo: toast }));
vi.mock('motion/react', async (original) => ({ ...await original<typeof import('motion/react')>(), useReducedMotion: () => true }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogPopup: ({ children }: { children: ReactNode }) => createElement('div', { role: 'dialog' }, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
}));
// The branch picker is a plain select here; the app's own is a popup.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange(value: string): void; children: ReactNode }) => createElement('select', { value, 'aria-label': 'select', onChange: (event: { target: { value: string } }) => onValueChange(event.target.value) }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => createElement('option', { value }, children),
}));
// The branch picker searches in a popup in the app; here it's a plain select of the same branches.
vi.mock('@/components/SearchablePicker', () => ({
  SearchablePicker: ({ value, onValueChange, groups }: { value: string; onValueChange(value: string): void; groups: { items: { value: string; label: string }[] }[] }) => createElement('select', {
    value, 'aria-label': 'Select branch', onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
  }, groups.flatMap((group) => group.items).map((item) => createElement('option', { key: item.value, value: item.value }, item.label))),
}));
// The question is asked inline here; the popover itself is covered by its own tests.
vi.mock('@/features/pulls/ConfirmPopover', () => ({
  ConfirmPopover: ({ children, confirm }: { children: ReactNode; confirm: ReactNode }) => createElement('div', { 'data-testid': 'confirm' }, children, confirm),
}));

const list: RunnableWorkflowList = {
  defaultBranch: 'main', viewerCanWrite: true, branches: ['main', 'feature/x'],
  workflows: [
    { id: 1, name: 'Prepare release', path: '.github/workflows/prepare-release.yml', triggers: { events: ['workflow_dispatch'], inputs: [
      { name: 'version', description: 'Without the leading v', required: true, default: null, type: 'string', options: [] },
      { name: 'prerelease', description: null, required: false, default: 'false', type: 'boolean', options: [] },
    ] } },
    { id: 2, name: 'Deploy website', path: '.github/workflows/website.yml', triggers: { events: ['workflow_dispatch'], inputs: [] } },
    { id: 3, name: 'CI', path: '.github/workflows/ci.yml', triggers: { events: ['push', 'pull_request'], inputs: null } },
  ],
};
const run = (id: number, workflowId: number, conclusion: string): ActionRunSummary => ({
  id, number: id, attempt: 1, title: `run ${id}`, workflowId, workflowName: 'w', status: 'completed', conclusion, event: 'workflow_dispatch',
  branch: 'main', headSha: 'a'.repeat(40), url: '', createdAt: '2026-11-05T10:00:00Z', startedAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:01:00Z',
  actor: null, pullRequestNumber: null,
});
const onOpenRun = vi.fn();
const onStarted = vi.fn();
const onClose = vi.fn();
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 3 });
  api.listRunnableWorkflows.mockResolvedValue(list);
  api.listActionRuns.mockImplementation(async (_repository: string, workflowId: number | null) => ({
    runs: workflowId === null ? [run(10, 2, 'success'), run(11, 2, 'failure'), run(12, 3, 'success')] : workflowId === 2 ? [run(10, 2, 'success'), run(11, 2, 'failure')] : [],
    hasMore: false,
  }));
  api.runWorkflow.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 }, mutations: { networkMode: 'always', retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render(initialWorkflowId: number | null = null) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null,
    createElement(RunWorkflowDialog, { repositoryId: 'repo', initialWorkflowId, onOpenRun, onStarted, onClose })))));
  await settle();
}
const options = () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim().startsWith(text))!;
/** Run stays focusable while off, so it can say why. */
const isOff = (element: HTMLButtonElement) => element.disabled || element.getAttribute('aria-disabled') === 'true';
async function click(element: HTMLElement) { await act(async () => element.click()); await settle(); }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

it('offers only workflows that can run manually, with their latest results, and folds the rest', async () => {
  await render();
  expect(options().map((option) => option.querySelector('.run-workflow-option-name')?.textContent)).toEqual(['Deploy website', 'Prepare release']);
  expect([...options()[0]!.querySelectorAll('.run-workflow-dots i')].map((dot) => dot.className)).toEqual(['action-success', 'action-failure']);
  const more = button('1 automatic');
  expect(more.getAttribute('aria-expanded')).toBe('false');
  await click(more);
  expect(container.querySelector('.run-workflow-automatic')?.textContent).toContain('CI');
  expect(container.querySelector('.run-workflow-automatic')?.textContent).toContain('Push');
});

it('shows the chosen workflow\'s latest runs beside it, which open in the viewer', async () => {
  await render(2);
  expect(container.querySelector('.run-workflow-title h3')?.textContent).toBe('Deploy website');
  const runs = [...container.querySelectorAll<HTMLButtonElement>('.run-workflow-run')];
  expect(runs.map((item) => item.querySelector('.run-workflow-run-title')?.textContent)).toEqual(['run 10', 'run 11']);
  await click(runs[1]!);
  expect(onOpenRun).toHaveBeenCalledWith(11);
  expect(onClose).toHaveBeenCalled();
});

it('asks for required inputs, then runs on the chosen branch with them after confirming', async () => {
  api.getWorkflowTriggers.mockResolvedValue(list.workflows[0]!.triggers);
  await render(1);
  const runButton = () => button('Run workflow');
  expect(isOff(runButton())).toBe(true);
  await type(container.querySelector<HTMLInputElement>('#run-workflow-input-version')!, '0.3.0');
  expect(isOff(runButton())).toBe(false);

  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Select branch"]')!;
    select.value = 'feature/x';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  expect(api.getWorkflowTriggers).toHaveBeenCalledWith('repo', '.github/workflows/prepare-release.yml', 'feature/x');
  expect(container.querySelector<HTMLInputElement>('#run-workflow-input-version')!.value).toBe('0.3.0');

  await click(runButton());
  expect(container.querySelector('[data-testid="confirm"]')?.textContent).toContain('feature/x');
  await click(button('Run Prepare release'));
  expect(api.runWorkflow).toHaveBeenCalledWith({
    repositoryId: 'repo', path: '.github/workflows/prepare-release.yml', ref: 'feature/x', inputs: { version: '0.3.0', prerelease: 'false' },
    expectedAccount: { login: 'sample', revision: 3 },
  });
  expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
});

it('stops a branch whose workflow file can\'t be run manually', async () => {
  api.getWorkflowTriggers.mockResolvedValue({ events: ['push'], inputs: null });
  await render(2);
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Select branch"]')!;
    select.value = 'feature/x';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  expect(isOff(button('Run workflow'))).toBe(true);
});

it('keeps Run off after an unconfirmed request until the runs are read again', async () => {
  api.runWorkflow.mockRejectedValue(Object.assign(new ServerRequestTimeoutError('Server request timed out'), { unconfirmed: true }));
  await render(2);
  await click(button('Run workflow'));
  await click(button('Run Deploy website'));
  expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'No answer from GitHub yet' }));
  expect(onStarted).not.toHaveBeenCalled();
  expect(isOff(button('Run workflow'))).toBe(true);
  await click(button('Refresh runs'));
  expect(isOff(button('Run workflow'))).toBe(false);
});
