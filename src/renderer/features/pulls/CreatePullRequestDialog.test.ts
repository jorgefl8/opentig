// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsStore } from '../../../main/persistence/SettingsStore';
import { draftContext } from '../../../main/ai/test-support/pull-request-context';
import type { GeneratedPullRequestDraft } from '@shared/contracts';
import { CreatePullRequestDialog } from './CreatePullRequestDialog';

const api = vi.hoisted(() => ({ generateDraft: vi.fn(), cancelDraft: vi.fn(), createPullRequest: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('./useGitHubAccount', () => ({ useGitHubAccount: () => ({ data: { state: 'ready', login: 'sample', revision: 1 }, isFetching: false }) }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? children : null,
  DialogPopup: ({ children }: { children: ReactNode }) => createElement('div', { role: 'dialog' }, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement('p', null, children),
}));
vi.mock('@/components/SearchablePicker', () => ({ SearchablePicker: ({ value, onValueChange }: { value: string; onValueChange(value: string): void }) => createElement('select', { 'aria-label': 'Base branch', value, onChange: (event: { target: { value: string } }) => onValueChange(event.target.value) },
  createElement('option', { value: 'origin/main' }, 'main'), createElement('option', { value: 'origin/release' }, 'release')) }));

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof CreatePullRequestDialog>;
const coverage = { ...draftContext().coverage, base: 'origin/main' };
const result: GeneratedPullRequestDraft = { title: 'Add feature', body: 'Describe feature.', harness: 'codex', model: 'default', contextWasTruncated: true,
  coverage: { ...coverage, commitsTotal: 50, files: [{ ...coverage.files[0]!, detail: 'partial', omittedChangedLines: 8, omittedHunks: 2 }] },
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  api.generateDraft.mockResolvedValue(result);
  api.cancelDraft.mockResolvedValue(undefined);
  props = {
    open: true, onOpenChange: vi.fn(), repositoryId: 'repo',
    branches: ['main', 'release'].map((name, index) => ({ name: `origin/${name}`, fullName: `refs/remotes/origin/${name}`, current: false, remote: true, upstream: null, ahead: 0, behind: 0, worktreePath: null, oid: (index ? 'c' : 'b').repeat(40), shortOid: '', subject: '', author: '', date: '' })),
    status: { branch: 'feature', oid: coverage.headOid, upstream: 'origin/feature', ahead: 0, behind: 0, insertions: 0, deletions: 0, detached: false, unborn: false, operation: null, readOnly: false, changes: [], stagedCount: 0, unstagedCount: 0 },
    preferences: { ...new SettingsStore('unused-settings.json').preferences, commitMessageHarness: 'codex' },
    aiProviders: [], pushBusy: false, onPush: vi.fn(), onCreated: vi.fn(), onOpenGitHubSettings: vi.fn(),
  };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
const render = () => act(async () => root.render(createElement(CreatePullRequestDialog, props)));
async function generate() { await act(async () => container.querySelector<HTMLButtonElement>('.create-pr-generate')!.click()); }
async function changeBase() {
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('[aria-label="Base branch"]')!; select.value = 'origin/release'; select.dispatchEvent(new Event('change', { bubbles: true })); });
}

it('keeps precise coverage next to the editable draft and marks it outdated after a base change', async () => {
  await render(); await generate();
  expect(container.querySelector<HTMLInputElement>('#create-pr-title')!.value).toBe('Add feature');
  const report = container.querySelector('[aria-label="Draft context coverage"]')!;
  expect(report.textContent).toContain('Partial draft context');
  expect(report.textContent).toContain('1 partial');
  expect(report.textContent).toContain('1 of 50 commit subjects');
  expect(report.textContent).toContain('8 changed lines omitted');
  expect(container.querySelector('textarea')!.value).toBe('Describe feature.');
  await changeBase();
  expect(report.textContent).toContain('Draft context is outdated');
  expect(container.querySelector('textarea')!.value).toBe('Describe feature.');
  expect(api.createPullRequest).not.toHaveBeenCalled();
});

it('rejects an in-flight result for a previous base without overwriting the current text', async () => {
  let resolve!: (draft: GeneratedPullRequestDraft) => void;
  api.generateDraft.mockImplementation(() => new Promise<GeneratedPullRequestDraft>(done => { resolve = done; }));
  await render(); await generate(); await changeBase();
  expect(api.cancelDraft).toHaveBeenCalledTimes(1);
  await act(async () => resolve(result));
  expect(container.querySelector<HTMLInputElement>('#create-pr-title')!.value).toBe('');
  expect(container.querySelector('[aria-label="Draft context coverage"]')).toBeNull();
});

it('shows compact complete input without a partial warning and detects a moved head', async () => {
  api.generateDraft.mockResolvedValue({ ...result, contextWasTruncated: false, coverage: { ...coverage, contextLines: 1 } });
  await render(); await generate();
  expect(container.textContent).toContain('Compact diff, all changes included');
  expect(container.querySelector('[data-warning]')).toBeNull();
  props = { ...props, status: { ...props.status!, oid: 'd'.repeat(40) } };
  await render();
  expect(container.textContent).toContain('Draft context is outdated');
});
