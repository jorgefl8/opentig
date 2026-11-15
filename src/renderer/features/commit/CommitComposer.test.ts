// @vitest-environment jsdom
import { act, createElement, createRef, useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommitSplitProposal, PrepareCommitGroupInput } from '@shared/contracts';
import type { FileChange, RepositoryStatus } from '@shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CommitComposer } from './CommitComposer';
import { StoredCommitComposer } from './StoredCommitComposer';
import { createCommitMessageStore } from './commit-message-store';
import { stagedPaths } from './commit-plan';
import { useCommitPlan, type CommitPlanController } from './useCommitPlan';

let root: Root;
let container: HTMLDivElement;
const onCommit = vi.fn();
const onGenerate = vi.fn();
const onCancelGenerate = vi.fn();
const onOpenPath = vi.fn();
const onOpenCommit = vi.fn();

const proposal: CommitSplitProposal = {
  rationale: 'These touch separate features.',
  commits: [
    { subject: 'feat: add search', body: 'Search by title.', message: 'feat: add search\n\nSearch by title.', reason: 'The search box', paths: ['src/search.ts'], fingerprint: 'a' },
    { subject: 'docs: describe search', body: '', message: 'docs: describe search', reason: 'The guide', paths: ['docs/search.md'], fingerprint: 'b' },
  ],
};
const SINGLE = 'feat: add search and its guide';

async function render(overrides: Partial<ComponentProps<typeof CommitComposer>> = {}) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(CommitComposer, {
    open: true, stagedCount: 1, message: 'feat: add search', generating: false, harness: 'codex', harnessLabel: 'Codex', modelLabel: 'Default', busy: null,
    readOnly: false, canPush: true, plan: null, outcome: null, changes: [], phone: false, textareaRef: createRef<HTMLTextAreaElement>(),
    onMessage: vi.fn(), onGenerate, onCancelGenerate, onPlanMode: vi.fn(), onActivateGroup: vi.fn(), onDiscardPlan: vi.fn(), onDismissOutcome: vi.fn(), onOpenPath, onOpenCommit, onCommit,
    ...overrides,
  }))));
}

const button = (name: string, scope: ParentNode = container) => [...scope.querySelectorAll('button')].find((item) => item.textContent === name);

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

it('redraws only the box while its text is typed, and gives that text to whoever asks for it', async () => {
  const store = createCommitMessageStore('');
  const surroundingsDrawn = vi.fn();
  // What the app is to the box: it holds the store and never the text.
  function Surroundings() {
    surroundingsDrawn();
    return createElement(TooltipProvider, null, createElement(StoredCommitComposer, {
      store, open: true, stagedCount: 1, generating: false, harness: 'codex', harnessLabel: 'Codex', modelLabel: 'Default', busy: null,
      readOnly: false, canPush: true, plan: null, outcome: null, changes: [], phone: false, textareaRef: createRef<HTMLTextAreaElement>(),
      onGenerate, onCancelGenerate, onPlanMode: vi.fn(), onActivateGroup: vi.fn(), onDiscardPlan: vi.fn(), onDismissOutcome: vi.fn(), onOpenPath, onOpenCommit, onCommit,
    }));
  }
  await act(async () => root.render(createElement(Surroundings)));
  expect(button('Commit 1 file')!.disabled).toBe(true);
  surroundingsDrawn.mockClear();
  const box = container.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  for (const text of ['f', 'fi', 'fix: a thing']) {
    await act(async () => { setter.call(box, text); box.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  expect(surroundingsDrawn).not.toHaveBeenCalled();
  expect(box.value).toBe('fix: a thing');
  expect(store.get()).toBe('fix: a thing');
  expect(button('Commit 1 file')!.disabled).toBe(false);
  // Text set from outside, as a generated message is, shows in the box.
  await act(async () => store.set('feat: generated'));
  expect(box.value).toBe('feat: generated');
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

/**
 * A repository's index, with the checks the server makes before it stages a
 * group: what is staged must be what the caller last saw.
 */
class FakeIndex {
  private changes: FileChange[];
  private listeners = new Set<() => void>();
  private current: RepositoryStatus;
  private commits = 0;
  /** Makes the next attempt to stage a group fail the way the server refuses a changed file. */
  refusal: string | null = null;

  constructor(paths: string[]) {
    this.changes = paths.map((path) => ({ path, indexStatus: 'M', worktreeStatus: '.', kind: path.endsWith('.md') ? 'added' : 'modified', staged: true, unstaged: false, conflict: false, submodule: 'N...' }));
    this.current = this.snapshot();
  }

  private snapshot(): RepositoryStatus {
    const staged = this.changes.filter((change) => change.staged).length;
    return { branch: 'main', oid: 'c'.repeat(40), upstream: null, ahead: 0, behind: 0, insertions: 0, deletions: 0, detached: false, unborn: false, operation: null, readOnly: false, changes: this.changes, stagedCount: staged, unstagedCount: this.changes.length - staged };
  }
  private update(next: FileChange[]) { this.changes = next; this.current = this.snapshot(); for (const listener of this.listeners) listener(); }
  private setStaged(staged: (change: FileChange) => boolean) { this.update(this.changes.map((change) => ({ ...change, staged: staged(change), unstaged: !staged(change) }))); }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  status = () => this.current;
  staged = () => stagedPaths(this.changes);

  readonly api = {
    prepareCommitGroup: async (input: PrepareCommitGroupInput) => {
      if (this.refusal) { const message = this.refusal; this.refusal = null; throw new Error(message); }
      if (input.expectedStagedPaths.join('\n') !== this.staged().join('\n')) throw new Error('Staged changes changed after the commit plan was shown. Generate a new plan.');
      this.setStaged((change) => input.paths.includes(change.path));
      return { ok: true as const };
    },
    stage: async (_repositoryId: string, paths: string[]) => {
      this.setStaged((change) => change.staged || paths.includes(change.path));
      return { ok: true as const };
    },
  };

  /** What staging or unstaging a row in the list does. */
  stageByHand(path: string, staged: boolean) { this.setStaged((change) => change.path === path ? staged : change.staged); }

  /** Commits everything staged, without telling anyone yet: the app only refreshes afterwards. */
  commit(): string {
    this.changes = this.changes.filter((change) => !change.staged);
    this.commits += 1;
    return String(this.commits).repeat(40);
  }
  refresh() { this.update(this.changes); }
}

let index: FakeIndex;
let plan: CommitPlanController;

/** The composer driven by the real plan logic, wired the way the app wires it. */
function PlanHarness({ open = true, phone = false }: { open?: boolean; phone?: boolean }) {
  const status = useSyncExternalStore(index.subscribe, index.status);
  // The text lives in a store, as in the app: the plan reads it when it needs it.
  const [messages] = useState(() => createCommitMessageStore(SINGLE));
  const setMessage = messages.set;
  const controller = useCommitPlan({ repositoryId: 'repository', status, getMessage: messages.get, setMessage, index: index.api });
  useEffect(() => { plan = controller; });
  return createElement(StoredCommitComposer, {
    store: messages, open, stagedCount: status.stagedCount, generating: false, harness: 'codex', harnessLabel: 'Codex', modelLabel: 'Default', busy: null,
    readOnly: false, canPush: true, plan: controller.plan, outcome: controller.outcome, changes: status.changes, phone, textareaRef: createRef<HTMLTextAreaElement>(),
    onGenerate, onCancelGenerate, onOpenPath, onOpenCommit,
    onPlanMode: (mode) => void controller.chooseMode(mode),
    onActivateGroup: (group) => void controller.activate(group),
    onDiscardPlan: () => void controller.discard(),
    onDismissOutcome: controller.clear,
    onCommit: (options) => {
      onCommit(options);
      const step = controller.stepToCommit();
      if (step === false) return;
      const oid = index.commit();
      const message = messages.get();
      setMessage('');
      void (step ? controller.committed({ oid, subject: message.split('\n', 1)[0]! }) : Promise.resolve(controller.clear())).then(() => index.refresh());
    },
  });
}

async function renderPlan(props: { open?: boolean; phone?: boolean } = {}) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(PlanHarness, props))));
}
async function startPlan(props: { phone?: boolean } = {}) {
  index = new FakeIndex(['docs/search.md', 'src/search.ts']);
  await renderPlan(props);
  await act(async () => plan.propose(proposal, SINGLE));
}
async function press(name: string, scope: ParentNode = container) {
  const target = [...scope.querySelectorAll('button')].find((item) => item.textContent === name);
  if (!target) throw new Error(`No "${name}" button in: ${scope.textContent}`);
  await act(async () => target.click());
  await settle();
}
const text = () => container.textContent ?? '';
const messageBox = () => container.querySelector('textarea');
const groups = () => [...container.querySelectorAll<HTMLElement>('.commit-plan-group')];
const pressed = (name: string) => button(name)?.getAttribute('aria-pressed') === 'true';

it('offers one commit or the split as a choice, and stages nothing differently until the split is chosen', async () => {
  await startPlan();
  expect(pressed('One commit')).toBe(true);
  expect(pressed('Split into 2')).toBe(false);
  expect(button('Commit 2 files')).toBeDefined();
  expect(messageBox()!.value).toBe(SINGLE);
  expect(groups()).toHaveLength(0);
  expect(index.staged()).toEqual(['docs/search.md', 'src/search.ts']);

  await press('Split into 2');
  expect(pressed('Split into 2')).toBe(true);
  expect(index.staged()).toEqual(['src/search.ts']);
  expect(button('Commit 2 files')).toBeUndefined();
  expect(button('Commit 1 of 2 · 1 file')).toBeDefined();
  expect(messageBox()!.value).toBe('feat: add search\n\nSearch by title.');
  expect(groups()[0]!.getAttribute('aria-current')).toBe('step');
  expect(groups()[0]!.textContent).toContain('Search by title.');
});

it('goes back to one commit with everything staged again and the message that was there', async () => {
  await startPlan();
  await press('Split into 2');
  await press('One commit');
  expect(index.staged()).toEqual(['docs/search.md', 'src/search.ts']);
  expect(button('Commit 2 files')).toBeDefined();
  expect(messageBox()!.value).toBe(SINGLE);
  expect(text()).not.toContain('Discard plan');
});

it('stages the next group as soon as one is committed, and says which commit the button makes', async () => {
  await startPlan();
  await press('Split into 2');
  await press('Commit 1 of 2 · 1 file');
  expect(onCommit).toHaveBeenLastCalledWith({ push: false });
  expect(index.staged()).toEqual(['docs/search.md']);
  expect(button('Commit 2 of 2 · 1 file')).toBeDefined();
  expect(messageBox()!.value).toBe('docs: describe search');
  expect(text()).toContain('1 of 2 committed');
  expect(container.querySelector('[role="status"]')!.textContent).toBe('1 of 2 committed. Next is commit 2: docs: describe search');
  // The commit it became, and no way back to a single commit.
  expect(groups()[0]!.classList.contains('done')).toBe(true);
  expect(groups()[0]!.textContent).toContain('1111111');
  expect(groups()[1]!.getAttribute('aria-current')).toBe('step');
  expect(button('One commit')!.disabled).toBe(true);
});

it('never pushes a commit of the plan, whatever the shortcut asks', async () => {
  await startPlan();
  await press('Split into 2');
  expect(container.querySelector('[aria-label="Choose the commit action"]')).toBeNull();
  await act(async () => { messageBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true })); });
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ push: false });
});

it('ends with the commits it created, each opening its commit', async () => {
  await startPlan();
  await press('Split into 2');
  await press('Commit 1 of 2 · 1 file');
  await press('Commit 2 of 2 · 1 file');
  expect(text()).toContain('2 commits created');
  expect(messageBox()).toBeNull();
  expect(groups()).toHaveLength(0);
  const created = [...container.querySelectorAll<HTMLButtonElement>('.commit-plan-created')];
  expect(created.map((item) => item.textContent)).toEqual(['1111111feat: add search', '2222222docs: describe search']);
  await act(async () => created[1]!.click());
  expect(onOpenCommit).toHaveBeenCalledWith({ oid: '2'.repeat(40), subject: 'docs: describe search' });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss the summary"]')!.click());
  expect(text()).toBe('');
});

it('lets another group go next, keeping the message already edited for the one left waiting', async () => {
  await startPlan();
  await press('Split into 2');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(messageBox(), 'feat: add search, reworded'); messageBox()!.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => groups()[1]!.querySelector<HTMLButtonElement>('.commit-plan-group-head')!.click());
  await press('Commit this one next', groups()[1]!);
  expect(index.staged()).toEqual(['docs/search.md']);
  expect(button('Commit 2 of 2 · 1 file')).toBeDefined();
  await act(async () => groups()[0]!.querySelector<HTMLButtonElement>('.commit-plan-group-head')!.click());
  await press('Commit this one next', groups()[0]!);
  expect(messageBox()!.value).toBe('feat: add search, reworded');
});

it('asks before discarding, then stages everything back as it was', async () => {
  await startPlan();
  await press('Split into 2');
  await press('Discard plan');
  expect(text()).toContain('Discard the plan? All 2 files will be staged again, as they were.');
  expect(index.staged()).toEqual(['src/search.ts']);
  await press('Cancel');
  expect(pressed('Split into 2')).toBe(true);
  await press('Discard plan');
  await press('Discard plan');
  expect(index.staged()).toEqual(['docs/search.md', 'src/search.ts']);
  expect(text()).toContain('Plan discarded. All 2 files are staged again.');
  expect(button('Split into 2')).toBeUndefined();
  expect(button('Commit 2 files')).toBeDefined();
  expect(messageBox()!.value).toBe(SINGLE);
});

it('discards the rest after a commit, staging what is left and keeping the commit', async () => {
  index = new FakeIndex(['docs/search.md', 'src/search.ts', 'test/search.test.ts']);
  await renderPlan();
  const third = { subject: 'test: cover search', body: '', message: 'test: cover search', reason: 'Tests', paths: ['test/search.test.ts'], fingerprint: 'c' };
  await act(async () => plan.propose({ ...proposal, commits: [...proposal.commits, third] }, SINGLE));
  await press('Split into 3');
  await press('Commit 1 of 3 · 1 file');
  await press('Discard plan');
  expect(text()).toContain('The 2 files left will be staged again, and the commit already created stays.');
  await press('Discard plan');
  expect(index.staged()).toEqual(['docs/search.md', 'test/search.test.ts']);
  expect(text()).toContain('Plan discarded. The 2 files left are staged again; your commit stays.');
  // The single message described the file that is already committed.
  expect(messageBox()!.value).toBe('');
});

it('stays on screen, paused with the reason, when files are staged by hand, and can go on', async () => {
  await startPlan();
  await press('Split into 2');
  await act(async () => { index.stageByHand('docs/search.md', true); plan.pause('You changed the staged files by hand.'); });
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('Commit plan paused. You changed the staged files by hand.');
  // What is staged is no longer the plan's group, so the button stops promising it.
  expect(button('Commit 1 of 2 · 1 file')).toBeUndefined();
  expect(button('Commit 2 files')).toBeDefined();
  expect(groups()).toHaveLength(0);
  await press('Resume plan');
  expect(index.staged()).toEqual(['src/search.ts']);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button('Commit 1 of 2 · 1 file')).toBeDefined();
});

it('pauses instead of committing when what is staged is not the group the button names', async () => {
  await startPlan();
  await press('Split into 2');
  // Staged from a terminal: nothing told the plan.
  await act(async () => index.stageByHand('docs/search.md', true));
  await press('Commit 1 of 2 · 1 file');
  expect(index.staged()).toEqual(['docs/search.md', 'src/search.ts']);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('The staged files no longer match commit 1 of 2.');
});

it('pauses with the server\'s reason when the next group cannot be staged, keeping the commit made', async () => {
  await startPlan();
  await press('Split into 2');
  index.refusal = 'These files changed after the commit plan was generated. Generate a new plan.';
  await press('Commit 1 of 2 · 1 file');
  const notice = container.querySelector('[role="alert"]')!.textContent;
  expect(notice).toContain('These files changed after the commit plan was generated. Generate a new plan.');
  expect(notice).toContain('The commit already created stays.');
  expect(index.staged()).toEqual([]);
  await press('Discard plan');
  expect(text()).toBe('');
});

it('opens each planned file in the diff that has it: staged for the next commit, unstaged for the ones waiting', async () => {
  await startPlan();
  await press('Split into 2');
  await act(async () => groups()[1]!.querySelector<HTMLButtonElement>('.commit-plan-group-head')!.click());
  await press('src/search.ts');
  expect(onOpenPath).toHaveBeenLastCalledWith('src/search.ts', 'staged');
  await press('docs/search.md');
  expect(onOpenPath).toHaveBeenLastCalledWith('docs/search.md', 'unstaged');
  expect(groups()[1]!.querySelector('.status-code')!.getAttribute('aria-label')).toBe('Added');

  await press('Commit 1 of 2 · 1 file');
  await act(async () => groups()[0]!.querySelector<HTMLButtonElement>('.commit-plan-group-head')!.click());
  await press('src/search.ts');
  expect(onOpenCommit).toHaveBeenLastCalledWith({ oid: '1'.repeat(40), subject: 'feat: add search' });
  expect(groups()[0]!.querySelector('.status-code')!.getAttribute('aria-label')).toBe('Modified');
});

it('opens the plan in a sheet on a phone, and has it open again after a file was viewed', async () => {
  await startPlan({ phone: true });
  await press('Split into 2');
  const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
  expect(sheet()!.textContent).toContain('feat: add search');
  expect(container.querySelector('.commit-plan-group')).toBeNull();
  // Viewing a file takes the list away, and the composer with it.
  await renderPlan({ phone: true, open: false });
  await settle();
  expect(sheet()).toBeNull();
  await renderPlan({ phone: true, open: true });
  await settle();
  expect(sheet()!.textContent).toContain('0 of 2 committed');
  await press('Commit 1 of 2 · 1 file', sheet()!);
  expect(sheet()!.textContent).toContain('1 of 2 committed');
  expect(button('Commit 2 of 2 · 1 file', sheet()!)).toBeDefined();
});
