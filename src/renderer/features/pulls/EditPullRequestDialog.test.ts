// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestDetails } from '@shared/contracts';
import { ServerRequestTimeoutError } from '@/lib/websocket-transport';
import { EditPullRequestDialog } from './EditPullRequestDialog';

const api = vi.hoisted(() => ({ updatePullRequest: vi.fn(), repositoryAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('sileo', () => ({ sileo: toast }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogPopup: ({ children }: { children: ReactNode }) => createElement('div', { role: 'dialog' }, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
}));

const details = { number: 7, title: 'Old title', body: 'Old body' } as PullRequestDetails;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const onClose = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.repositoryAccount.mockResolvedValue({ state: 'ready', login: 'sample', revision: 3 });
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 }, mutations: { networkMode: 'always', retry: false } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function settle() {
  for (let tick = 0; tick < 5; tick++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(EditPullRequestDialog, { repositoryId: 'repo', details, expectedUpdatedAt: '2026-01-01T00:00:00Z', onClose }))));
  await settle();
}
const saveButton = () => [...container.querySelectorAll('button')].find(item => item.textContent === 'Save changes')!;
async function setTitle(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#edit-pr-title')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('starts from the current text and sends what was edited, with the version it started from', async () => {
  api.updatePullRequest.mockResolvedValue(undefined);
  await render();
  expect(container.querySelector<HTMLInputElement>('#edit-pr-title')?.value).toBe('Old title');
  expect(container.querySelector<HTMLTextAreaElement>('#edit-pr-body')?.value).toBe('Old body');
  await setTitle('  New title ');
  await act(async () => saveButton().click());
  await settle();
  expect(api.updatePullRequest).toHaveBeenCalledWith({ repositoryId: 'repo', number: 7, title: 'New title', body: 'Old body', expectedUpdatedAt: '2026-01-01T00:00:00Z', expectedAccount: { login: 'sample', revision: 3 } });
  expect(onClose).toHaveBeenCalledOnce();
});

it('needs a title', async () => {
  await render();
  await setTitle('   ');
  expect(saveButton().disabled).toBe(true);
});

it('keeps the text when GitHub changed first', async () => {
  api.updatePullRequest.mockRejectedValue(Object.assign(new Error('changed'), { detail: { code: 'GH_PR_STATE_CHANGED', operation: 'gh-pr-update', message: 'This pull request changed on GitHub after you started editing. Your changes were not saved.' } }));
  await render();
  await setTitle('Mine');
  await act(async () => saveButton().click());
  await settle();
  expect(toast.error).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('not saved') }));
  expect(container.querySelector<HTMLInputElement>('#edit-pr-title')?.value).toBe('Mine');
  expect(onClose).not.toHaveBeenCalled();
});

it('says the save may have worked when there is no answer', async () => {
  api.updatePullRequest.mockRejectedValue(new ServerRequestTimeoutError('Server request timed out'));
  await render();
  await act(async () => saveButton().click());
  await settle();
  expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('may have been saved') }));
  expect(toast.error).not.toHaveBeenCalled();
});
