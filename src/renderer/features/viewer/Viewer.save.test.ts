// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WriteFileResult } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import Viewer from './Viewer';

const calls = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), save: null as null | ((path: string, content: string, expected: string) => Promise<WriteFileResult>) }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { repository: { readFile: calls.readFile, writeFile: calls.writeFile } } }));
// The Markdown editor stands in for every editor: what matters is the save it is handed.
vi.mock('@/features/markdown/MarkdownFileViewer', () => ({
  MarkdownFileViewer: (props: { onSave(path: string, content: string, expected: string): Promise<WriteFileResult> }) => { calls.save = props.onSave; return createElement('div', null, 'Editor'); },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls.readFile.mockImplementation(async (_id: string, path: string) => ({ path, content: 'before', binary: false, tooLarge: false, size: 6, mtimeMs: 1 }));
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
