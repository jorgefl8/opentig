// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommitInfo } from '../../../shared/git-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import Viewer, { type ViewerSelection } from './Viewer';

const calls = vi.hoisted(() => ({ getCommit: vi.fn(), getCommitFile: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { diff: calls } }));
vi.mock('./PierreDiffViewer', () => ({ default: () => createElement('div', { 'data-testid': 'diff' }, 'Rendered diff') }));
let root: Root;
let container: HTMLDivElement;
const description = Array.from({ length: 30 }, (_, index) => `Description line ${index}`).join('\n');
const commit: CommitInfo = {
  oid: 'a'.repeat(40), shortOid: 'aaaaaaa', subject: 'Full commit subject', body: description,
  author: 'Sample author', email: 'sample@example.invalid', date: '2026-01-01T12:00:00Z',
  decorations: [], parentOids: ['b'.repeat(40), 'c'.repeat(40)], parentCount: 2,
  upstreamState: 'published', isHead: false,
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls.getCommit.mockResolvedValue({ path: commit.oid, patch: '', binary: false, tooLarge: false, lineCount: 0 });
  calls.getCommitFile.mockResolvedValue({ path: 'file.txt', patch: '', binary: false, tooLarge: false, lineCount: 0 });
  calls.get.mockResolvedValue({ path: 'file.txt', patch: '', binary: false, tooLarge: false, lineCount: 0 });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks();
});

async function render(selection: ViewerSelection, commits = [commit]) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(Viewer, {
    repositoryId: 'commit-view-test', selection, commits, diffView: 'unified', wrapLines: false, theme: 'light', revision: 0, readOnly: true,
    draftFor: () => null, onSelect: vi.fn(), onOpenFile: vi.fn(), onDiffViewChange: vi.fn(), onWrapLinesChange: vi.fn(),
    onDraftChange: vi.fn(), onDraftSaved: vi.fn(), onUpdateConflict: async () => false, onResolveConflict: async () => false,
  }))));
}

it.each([2, 1, 0])('opens a commit with %i parents and no patch with its full header and message', async (parentCount) => {
  const selectedCommit = { ...commit, oid: String(parentCount).repeat(40), parentCount, subject: `Commit with ${parentCount} parents` };
  await render({ type: 'commit', oid: selectedCommit.oid, subject: selectedCommit.subject }, [selectedCommit]);
  expect(calls.getCommit).toHaveBeenCalledWith('commit-view-test', selectedCommit.oid);
  expect(container.querySelector('h2')?.textContent).toBe(selectedCommit.subject);
  expect(container.querySelector('.commit-diff-meta')?.textContent).toContain('Sample author');
  expect(container.querySelector('.commit-diff-description')?.textContent).toBe(description);
  expect(container.querySelector('.commit-diff-description')?.classList.contains('collapsed')).toBe(false);
  expect(container.textContent).toContain(parentCount > 1 ? 'This merge commit has no changes of its own.' : 'No differences to show.');
  expect(container.querySelector('[data-testid="diff"]')).toBeNull();
});

it('keeps the commit header when a commit file has no patch', async () => {
  await render({ type: 'commit-file', oid: commit.oid, path: 'file.txt' });
  expect(container.querySelector('h2')?.textContent).toBe(commit.subject);
  expect(container.querySelector('.commit-diff-description')?.textContent).toBe(description);
  expect(container.textContent).toContain('No differences to show.');
  expect(container.textContent).not.toContain('has no changes of its own');
});

it('does not add a commit header to an empty working-tree diff', async () => {
  await render({ type: 'diff', kind: 'unstaged', path: 'file.txt' });
  expect(container.querySelector('.commit-diff-header')).toBeNull();
  expect(container.textContent).toContain('No differences to show.');
});
