// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PullRequestCommit, PullRequestFileList } from '@shared/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { forgetViewerMemory, restoreViewerMemory, snapshotViewerMemory } from '@/features/viewer/viewer-memory';
import PullRequestDiff from './PullRequestDiff';

const api = vi.hoisted(() => ({ getPullRequestFiles: vi.fn(), getPullRequestFileDiff: vi.fn(), getPullRequestCommitDiff: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { github: api } }));
vi.mock('@/features/viewer/pierre-pool', () => ({ getHighlightPool: () => undefined }));
vi.mock('@pierre/diffs/react', async () => {
  const { createElement: element, createContext } = await import('react');
  return {
    Virtualizer: ({ children, className }: { children: React.ReactNode; className: string }) => element('div', { className }, children),
    FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => element('div', { 'data-code-file': fileDiff.name }, fileDiff.name),
    useWorkerPool: () => undefined,
    WorkerPoolContext: createContext(undefined),
  };
});

const base = 'b'.repeat(40);
const head = 'a'.repeat(40);
const first = 'c'.repeat(40);
const commit = (oid: string): PullRequestCommit => ({ oid, messageHeadline: `Commit ${oid.slice(0, 7)}`, author: 'sample', authorAvatarUrl: null, authoredAt: '2026-01-01T00:00:00Z' });
const list: PullRequestFileList = { source: 'git', omitted: 0, complete: true, files: [{ path: 'src/a.ts', oldPath: null, kind: 'modified', additions: 1, deletions: 1, binary: false, size: 20 }] };

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
beforeEach(() => {
  forgetViewerMemory();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); client.clear(); vi.unstubAllGlobals(); vi.resetAllMocks();
});

async function render(range: { baseOid: string; headOid: string }, commits: PullRequestCommit[], files = list, changedFiles = 1) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestDiff, {
    code: { files }, range, changedFiles, prNumber: 7, repositoryId: 'repo', commits,
    diffView: 'unified', themeType: 'light', wrapLines: false, onDiffViewChange: () => undefined, onWrapLinesChange: () => undefined, onClose: () => undefined,
  })))));
}
/** The error the server gives when a pull request's commits left the clone. */
const commitsMissing = () => Object.assign(new Error('This pull request’s commits are no longer in the clone.'), {
  detail: { code: 'PULL_REQUEST_COMMITS_MISSING', operation: 'pr-local-file-diff', message: 'This pull request’s commits are no longer in the clone.' },
});
const settle = async () => { for (let tick = 0; tick < 4; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

it('keeps reading an open file when the details are read again with the same commits', async () => {
  api.getPullRequestFileDiff.mockReturnValue(new Promise(() => {}));
  await render({ baseOid: base, headOid: head }, [commit(first)]);
  await act(async () => container.querySelector<HTMLButtonElement>('.diff-file-toggle')!.click());
  await settle();
  expect(api.getPullRequestFileDiff).toHaveBeenCalledTimes(1);
  // A new comment or title: new objects, the same two commits and the same commit list.
  await render({ baseOid: base, headOid: head }, [commit(first)]);
  await settle();
  expect(api.getPullRequestFileDiff).toHaveBeenCalledTimes(1);
});

it('goes back to all the changes when the commit list Back remembers is empty, and remembers the commit it shows', async () => {
  const vanished = 'e'.repeat(40);
  restoreViewerMemory({ views: [['repo:pull:7:code', { mode: 'commit', commit: vanished }]] });
  await render({ baseOid: base, headOid: head }, []);
  expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('All changes');
  expect(container.textContent).not.toContain('Loading the commit’s files');

  await act(async () => root.unmount());
  root = createRoot(container);
  restoreViewerMemory({ views: [['repo:pull:7:code', { mode: 'commit', commit: vanished }]] });
  api.getPullRequestFiles.mockResolvedValue(list);
  await render({ baseOid: base, headOid: head }, [commit(first)]);
  await settle();
  expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('By commit');
  expect(snapshotViewerMemory('repo:pull:7').views).toContainEqual(['repo:pull:7:code', { mode: 'commit', commit: first }]);
});

it('reads the list again when a file cannot be read, which brings the commits back, and then reads the file once more', async () => {
  api.getPullRequestFileDiff
    .mockRejectedValueOnce(commitsMissing())
    .mockResolvedValueOnce({ path: 'src/a.ts', patch: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n', binary: false, truncated: false, lineCount: 6 });
  api.getPullRequestFiles.mockResolvedValue(list);
  await render({ baseOid: base, headOid: 'f'.repeat(40) }, [commit(first)]);
  await act(async () => container.querySelector<HTMLButtonElement>('.diff-file-toggle')!.click());
  await settle();
  expect(api.getPullRequestFiles).toHaveBeenCalledTimes(1);
  expect(api.getPullRequestFileDiff).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-code-file]')).not.toBeNull();
  expect(container.textContent).not.toContain('no longer in the clone');
});

it('says how many files a list Git could not read in full leaves out', async () => {
  await render({ baseOid: base, headOid: head }, [commit(first)], { ...list, complete: false }, 40);
  expect(container.textContent).toContain('39 more files are not listed: this pull request changes too many files to list them all.');
});

it('reads the list again only for commits that left the clone, once for every file waiting on it', async () => {
  const files: PullRequestFileList = { ...list, files: ['src/a.ts', 'src/b.ts', 'src/c.ts'].map((path) => ({ ...list.files[0]!, path })) };
  let relisted!: () => void;
  api.getPullRequestFiles.mockReturnValue(new Promise((resolve) => { relisted = () => resolve(files); }));
  api.getPullRequestFileDiff.mockImplementation(async (_id: string, _number: number, _scope: unknown, file: { path: string }) => {
    if (file.path === 'src/c.ts') throw Object.assign(new Error('Invalid file.'), { detail: { code: 'INVALID_ARGUMENT', operation: 'pr-local-file-diff', message: 'Invalid file.' } });
    throw commitsMissing();
  });
  await render({ baseOid: base, headOid: '9'.repeat(40) }, [commit(first)], files, 3);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand all files"]')!.click());
  await settle();
  // Two files wait on one read of the list; the file Git refused is not retried.
  expect(api.getPullRequestFiles).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Invalid file.');
  api.getPullRequestFileDiff.mockResolvedValue({ path: 'src/a.ts', patch: '', binary: false, truncated: false, lineCount: 0 });
  relisted();
  await settle();
  expect(api.getPullRequestFiles).toHaveBeenCalledTimes(1);
  expect(api.getPullRequestFileDiff).toHaveBeenCalledTimes(5);
});

it('waits for the rest of the commits before showing another than the one Back remembers', async () => {
  const later = 'd'.repeat(40);
  restoreViewerMemory({ views: [['repo:pull:7:code', { mode: 'commit', commit: later }]] });
  api.getPullRequestFiles.mockResolvedValue(list);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(TooltipProvider, null, createElement(PullRequestDiff, {
    code: { files: list }, range: { baseOid: base, headOid: head }, changedFiles: 1, commitsSettled: false, prNumber: 7, repositoryId: 'repo', commits: [commit(first)],
    diffView: 'unified', themeType: 'light', wrapLines: false, onDiffViewChange: () => undefined, onWrapLinesChange: () => undefined, onClose: () => undefined,
  })))));
  await settle();
  expect(container.textContent).toContain('Loading the pull request’s commits');
  expect(api.getPullRequestFiles).not.toHaveBeenCalled();
  expect(snapshotViewerMemory('repo:pull:7').views ?? []).not.toContainEqual(['repo:pull:7:code', expect.objectContaining({ commit: first })]);
});

it('says a commit’s list is incomplete in a sentence that needs no count', async () => {
  restoreViewerMemory({ views: [['repo:pull:7:code', { mode: 'commit', commit: first }]] });
  api.getPullRequestFiles.mockResolvedValue({ ...list, complete: false });
  await render({ baseOid: base, headOid: head }, [commit(first)]);
  await settle();
  expect(container.textContent).toContain('Not every file is listed: this commit changes too many files to list them all.');
});
