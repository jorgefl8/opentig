// @vitest-environment jsdom
import { act, createElement, createRef, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommitSplitProposal } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CommitComposer } from './CommitComposer';

let root: Root;
let container: HTMLDivElement;
const onCommit = vi.fn();
const onGenerate = vi.fn();
const onCancelGenerate = vi.fn();
const onPrepare = vi.fn();

const proposal: CommitSplitProposal = {
  rationale: 'These touch separate features.',
  commits: [
    { subject: 'feat: add search', body: '', message: 'feat: add search', reason: 'The search box', paths: ['src/search.ts'], fingerprint: 'a' },
    { subject: 'docs: describe search', body: '', message: 'docs: describe search', reason: 'The guide', paths: ['docs/search.md'], fingerprint: 'b' },
  ],
};

async function render(overrides: Partial<ComponentProps<typeof CommitComposer>> = {}) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(CommitComposer, {
    open: true, stagedCount: 1, message: 'feat: add search', generating: false, harness: 'codex', harnessLabel: 'Codex', modelLabel: 'Default', busy: null,
    readOnly: false, canPush: true, proposal: null, preparedIndex: null, completed: new Set<number>(), collapsed: false, textareaRef: createRef<HTMLTextAreaElement>(),
    onMessage: vi.fn(), onGenerate, onCancelGenerate, onDismissProposal: vi.fn(), onToggleCollapsed: vi.fn(), onOpenPath: vi.fn(), onPrepare, onCommit,
    ...overrides,
  }))));
}

const button = (name: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('renders nothing while closed', async () => {
  await render({ open: false });
  expect(container.textContent).toBe('');
});

async function settle() {
  for (let tick = 0; tick < 4; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
async function choose(name: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose the commit action"]')!.click());
  await settle();
  await act(async () => items().find((item) => item.textContent?.startsWith(name))!.click());
  await settle();
}

it('names the staged files on the main action, which commits without pushing', async () => {
  await render();
  await act(async () => button('Commit 1 file')!.click());
  expect(onCommit).toHaveBeenCalledWith({ push: false });
  await render({ stagedCount: 3 });
  expect(button('Commit 3 files')).toBeDefined();
});

it('choosing commit and push only changes the button, which then has to be pressed', async () => {
  await render();
  await choose('Commit and push');
  expect(onCommit).not.toHaveBeenCalled();
  expect(button('Commit 1 file')).toBeUndefined();
  await act(async () => button('Commit and push')!.click());
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ push: true });
  await choose('Commit');
  expect(onCommit).toHaveBeenCalledOnce();
  await act(async () => button('Commit 1 file')!.click());
  expect(onCommit).toHaveBeenLastCalledWith({ push: false });
});

it('never pushes where pushing is not possible, whatever was chosen', async () => {
  await render();
  await choose('Commit and push');
  await render({ canPush: false });
  expect(button('Commit and push')).toBeUndefined();
  await act(async () => button('Commit 1 file')!.click());
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ push: false });
});

it('keeps the action in place but off until there is a message', async () => {
  await render({ message: '   ' });
  expect(button('Commit 1 file')?.disabled).toBe(true);
  await render({ message: 'fix: a thing', canPush: false });
  expect(button('Commit 1 file')?.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose the commit action"]')!.click());
  await settle();
  expect(items().find((item) => item.textContent?.startsWith('Commit and push'))?.hasAttribute('data-disabled')).toBe(true);
});

it('holds the commit while a generation can still replace the message, from the buttons and the shortcut', async () => {
  await render({ generating: true });
  expect(button('Commit 1 file')?.disabled).toBe(true);
  const textarea = container.querySelector('textarea')!;
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); });
  expect(onCommit).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Cancel generation"]')!.click());
  expect(onCancelGenerate).toHaveBeenCalledOnce();
});

it('commits from the textarea with the shortcut, and pushes too with Shift', async () => {
  await render();
  const textarea = container.querySelector('textarea')!;
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); });
  expect(onCommit).toHaveBeenLastCalledWith({ push: false });
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true })); });
  expect(onCommit).toHaveBeenLastCalledWith({ push: true });
});

it('exposes the textarea through its ref so the app can focus it', async () => {
  const textareaRef = createRef<HTMLTextAreaElement>();
  await render({ textareaRef });
  expect(textareaRef.current).toBe(container.querySelector('textarea'));
  expect(textareaRef.current?.getAttribute('aria-label')).toBe('Commit message');
});

it('runs what the button says from the shortcut', async () => {
  await render();
  await choose('Commit and push');
  await act(async () => { container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); });
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ push: true });
});

it('shows the provider on the generate action, with its model in the name', async () => {
  await render({ harnessLabel: 'Codex', modelLabel: 'GPT-5' });
  const generate = container.querySelector<HTMLButtonElement>('.commit-composer-generate')!;
  expect(generate.textContent).toBe('Codex');
  expect(generate.getAttribute('aria-label')).toBe('Generate with Codex · GPT-5');
  await act(async () => generate.click());
  expect(onGenerate).toHaveBeenCalledOnce();
});

it('shows a plan alone once the prepared group is committed and nothing is staged', async () => {
  await render({ stagedCount: 0, message: '', proposal, completed: new Set([0]) });
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('.commit-composer-commit')).toBeNull();
  expect(container.querySelector('.commit-plan-progress')?.textContent).toBe('1 of 2 done');
  expect(button('Committed')?.disabled).toBe(true);
  await act(async () => button('Prepare')!.click());
  expect(onPrepare).toHaveBeenCalledWith(1);
});

it('marks the prepared group and hides the list when the plan is collapsed', async () => {
  await render({ proposal, preparedIndex: 1 });
  expect(container.querySelector('article[aria-current="step"]')?.textContent).toContain('2. docs: describe search');
  expect(button('Prepared')?.disabled).toBe(true);
  await render({ proposal, collapsed: true });
  expect(container.querySelector('.commit-plan-list')).toBeNull();
  expect(button('Show plan')).toBeDefined();
});
