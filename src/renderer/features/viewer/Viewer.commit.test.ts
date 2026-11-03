// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function render(selection: ViewerSelection, commits = [commit], overrides: Partial<Parameters<typeof Viewer>[0]> = {}) {
  const props = {
    repositoryId: 'commit-view-test', selection, commits, diffView: 'unified' as const, wrapLines: false, theme: 'light' as const, revision: 0, readOnly: true,
    draftFor: () => null, onSelect: vi.fn(), onOpenFile: vi.fn(), onDiffViewChange: vi.fn(), onWrapLinesChange: vi.fn(),
    onDraftChange: vi.fn(), onDraftSaved: vi.fn(), onUpdateConflict: async () => false, onResolveConflict: async () => false,
    ...overrides,
  };
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(Viewer, props))));
  return props;
}
async function openMenu() {
  await act(async () => container.querySelector<HTMLElement>('[aria-label="More commit actions"]')!.click());
  await act(async () => { await Promise.resolve(); });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}
const labels = (items: HTMLElement[]) => items.map((item) => item.textContent);

it.each([2, 1, 0])('opens a commit with %i parents and no patch with its full header and message', async (parentCount) => {
  const selectedCommit = { ...commit, oid: String(parentCount).repeat(40), parentCount, subject: `Commit with ${parentCount} parents` };
  await render({ type: 'commit', oid: selectedCommit.oid, subject: selectedCommit.subject }, [selectedCommit]);
  expect(calls.getCommit).toHaveBeenCalledWith('commit-view-test', selectedCommit.oid);
  expect(container.querySelector('h2')?.textContent).toBe(selectedCommit.subject);
  expect(container.querySelector('.commit-diff-meta')?.textContent).toContain('Sample author');
  expect(container.querySelector('.commit-diff-description')?.textContent).toBe(description);
  // A long message starts folded, and opens in full on request.
  expect(container.querySelector('.commit-diff-description')?.classList.contains('collapsed')).toBe(true);
  const toggle = container.querySelector<HTMLButtonElement>('.commit-description-toggle')!;
  expect(toggle.textContent).toBe('Show full description');
  await act(async () => toggle.click());
  expect(container.querySelector('.commit-diff-description')?.classList.contains('collapsed')).toBe(false);
  expect(toggle.textContent).toBe('Show less');
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

it('reads as one muted line, saying so in words when the commit is not published', async () => {
  const local = { ...commit, parentOids: ['b'.repeat(40)], parentCount: 1, upstreamState: 'local-only' as const };
  await render({ type: 'commit', oid: commit.oid, subject: commit.subject }, [local]);
  const meta = container.querySelector('.commit-diff-meta')!;
  expect(meta.querySelector('code')?.textContent).toBe('aaaaaaa');
  expect(meta.textContent).toContain('aaaaaaa·Sample author·');
  expect(meta.textContent).not.toContain('sample@example.invalid');
  expect(meta.querySelector('.commit-local-label')?.textContent).toBe('Not published');
  await render({ type: 'commit', oid: commit.oid, subject: commit.subject }, [{ ...local, upstreamState: 'published' }]);
  expect(container.querySelector('.commit-local-label')).toBeNull();
});

describe('the commit menu', () => {
  const head = { ...commit, parentOids: ['b'.repeat(40)], parentCount: 1, upstreamState: 'local-only' as const, isHead: true };
  const selection: ViewerSelection = { type: 'commit', oid: commit.oid, subject: commit.subject };

  it('opens a published commit on GitHub only when the repository is there', async () => {
    await render(selection, [commit]);
    expect(labels(await openMenu())).toEqual(['Copy full hash', 'Close']);
    await act(async () => document.body.click());
    await act(async () => root.render(null));
    await render(selection, [commit], { githubRepository: 'owner/name' });
    const items = await openMenu();
    expect(labels(items)).toEqual(['Copy full hash', 'Open on GitHub', 'Close']);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => items[1]!.click());
    expect(open).toHaveBeenCalledWith(`https://github.com/owner/name/commit/${commit.oid}`, '_blank', expect.anything());
  });

  it('keeps a local commit out of GitHub and offers its undo unless something blocks it', async () => {
    const onUndoCommit = vi.fn();
    await render(selection, [head], { readOnly: false, githubRepository: 'owner/name', onUndoCommit });
    const items = await openMenu();
    expect(labels(items)).toEqual(['Copy full hash', 'Undo commit…', 'Close']);
    await act(async () => items[1]!.click());
    expect(onUndoCommit).toHaveBeenCalledWith(head);
  });

  it.each([
    ['read-only', { readOnly: true }],
    ['busy', { readOnly: false, undoBlocked: true }],
  ])('does not offer undo while the repository is %s', async (_, overrides) => {
    await render(selection, [head], { ...overrides, onUndoCommit: vi.fn() });
    expect(labels(await openMenu())).toEqual(['Copy full hash', 'Close']);
  });

  it('closes the commit from the menu', async () => {
    const props = await render(selection, [commit]);
    const items = await openMenu();
    await act(async () => items.at(-1)!.click());
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });
});

it('does not add a commit header to an empty working-tree diff', async () => {
  await render({ type: 'diff', kind: 'unstaged', path: 'file.txt' });
  expect(container.querySelector('.commit-diff-header')).toBeNull();
  expect(container.textContent).toContain('No differences to show.');
});

it('opens web links from the full commit subject and body in another tab while preserving plain text', async () => {
  const linkedCommit = { ...commit, subject: 'See https://example.com/issue', body: 'Details\nhttps://example.com/fix.\n`https://example.com/code`\n<script>plain text</script>' };
  await render({ type: 'commit', oid: commit.oid, subject: linkedCommit.subject }, [linkedCommit]);
  const links = container.querySelectorAll<HTMLAnchorElement>('.commit-diff-viewer a');
  expect([...links].map(link => link.href)).toEqual(['https://example.com/issue', 'https://example.com/fix']);
  for (const link of links) {
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.hasAttribute('title')).toBe(false);
  }
  expect(container.querySelector('.commit-diff-description')?.textContent).toBe(linkedCommit.body);
  expect(container.querySelector('script')).toBeNull();
});
