// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WriteFileResult } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import Viewer from './Viewer';

const calls = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), save: null as null | ((path: string, content: string, expected: string) => Promise<WriteFileResult>), type: null as null | ((content: string) => void) }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { repository: { readFile: calls.readFile, writeFile: calls.writeFile } } }));
// The Markdown editor stands in for every editor: what matters is the save it is handed.
vi.mock('@/features/markdown/MarkdownFileViewer', () => ({
  MarkdownFileViewer: (props: { file: { content: string }; onSave(path: string, content: string, expected: string): Promise<WriteFileResult>; onDraftChange(content: string): void }) => {
    calls.save = props.onSave;
    calls.type = props.onDraftChange;
    return createElement('div', null, `Editor:${props.file.content}`);
  },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls.readFile.mockImplementation(async (id: string, path: string) => ({ path, content: id === 'worktree-b' ? 'in b' : 'before', binary: false, tooLarge: false, size: 6, mtimeMs: 1 }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks(); calls.save = null; });

it('reports a save as done in the repository it began in, though another is open when it returns', async () => {
  const onDraftSaved = vi.fn();
  const props = (repositoryId: string) => ({
    repositoryId, selection: { type: 'file' as const, path: 'README.md' }, commits: [], diffView: 'unified' as const, wrapLines: false, theme: 'light' as const, revision: 0, readOnly: false,
    draftFor: () => null, onSelect: vi.fn(), onOpenFile: vi.fn(), onDiffViewChange: vi.fn(), onWrapLinesChange: vi.fn(),
    onDraftChange: vi.fn(), onDraftSaved, onUpdateConflict: async () => false, onResolveConflict: async () => false,
  });
  const render = async (repositoryId: string) => {
    await act(async () => root.render(createElement(TooltipProvider, null, createElement(Viewer, props(repositoryId)))));
    for (let tick = 0; tick < 40 && !container.textContent?.includes('Editor'); tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  };
  await render('worktree-a');
  let finish!: (result: WriteFileResult) => void;
  calls.writeFile.mockReturnValue(new Promise<WriteFileResult>((resolve) => { finish = resolve; }));
  const saving = calls.save!('README.md', 'after', 'before');
  // Worktree B opens, with its own README.md, before the write returns.
  await render('worktree-b');
  await act(async () => { finish({ status: 'saved', path: 'README.md', size: 5, mtimeMs: 2 } as WriteFileResult); await saving; });
  expect(calls.writeFile).toHaveBeenCalledWith('worktree-a', 'README.md', 'after', 'before');
  expect(onDraftSaved).toHaveBeenCalledExactlyOnceWith('README.md', 'worktree-a');
});

function viewerProps(repositoryId: string, handlers: { onDraftSaved?: unknown; onDraftChange?: unknown } = {}) {
  return {
    repositoryId, selection: { type: 'file' as const, path: 'README.md' }, commits: [], diffView: 'unified' as const, wrapLines: false, theme: 'light' as const, revision: 0, readOnly: false,
    draftFor: () => null, onSelect: vi.fn(), onOpenFile: vi.fn(), onDiffViewChange: vi.fn(), onWrapLinesChange: vi.fn(),
    onDraftChange: vi.fn(), onDraftSaved: vi.fn(), onUpdateConflict: async () => false, onResolveConflict: async () => false, ...handlers,
  };
}
async function show(props: ReturnType<typeof viewerProps>, text = 'Editor') {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(Viewer, props))));
  for (let tick = 0; tick < 40 && !container.textContent?.includes(text); tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

it('saves and keeps drafts of the document on screen in its own repository while another one loads', async () => {
  const onDraftChange = vi.fn();
  await show(viewerProps('worktree-a', { onDraftChange }), 'Editor:before');
  // Worktree B, with its own README.md, opens; its read has not landed, so A's document is still on screen.
  calls.readFile.mockImplementation(() => new Promise(() => {}));
  await show(viewerProps('worktree-b', { onDraftChange }), 'Editor:before');
  expect(container.textContent).toContain('Editor:before');
  calls.writeFile.mockResolvedValue({ status: 'saved', path: 'README.md', size: 5, mtimeMs: 2 });
  await act(async () => { calls.type!('typed in a'); await calls.save!('README.md', 'typed in a', 'before'); });
  expect(onDraftChange).toHaveBeenCalledWith('README.md', 'typed in a', 'before', 1, 'worktree-a');
  expect(calls.writeFile).toHaveBeenCalledExactlyOnceWith('worktree-a', 'README.md', 'typed in a', 'before');
});

it('leaves another repository\'s document with the same path as it is when a save returns', async () => {
  await show(viewerProps('worktree-a'), 'Editor:before');
  let finish!: (result: WriteFileResult) => void;
  calls.writeFile.mockReturnValue(new Promise<WriteFileResult>((resolve) => { finish = resolve; }));
  const saving = calls.save!('README.md', 'after', 'before');
  await show(viewerProps('worktree-b'), 'Editor:in b');
  await act(async () => { finish({ status: 'saved', path: 'README.md', size: 5, mtimeMs: 2 } as WriteFileResult); await saving; });
  expect(container.textContent).toContain('Editor:in b');
  expect(container.textContent).not.toContain('Editor:after');
});
