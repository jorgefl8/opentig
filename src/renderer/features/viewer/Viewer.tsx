import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { IconLoader4 } from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, FileResult, ImageFileResult, ThemePreference, WriteFileResult } from '../../../shared/contracts';
import type { CommitInfo } from '../../../shared/git-types';
import { isKnownImagePath, isSvgPath } from '../../../shared/image-types';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { isHtmlPath, isMarkdownPath } from '@/features/files/file-tree';
import { MarkdownFileViewer } from '@/features/markdown/MarkdownFileViewer';
import { PullRequestViewer } from '@/features/pulls/PullRequestViewer';
import { ByteBudgetLru } from '@/lib/ByteBudgetLru';
import { EditableFileViewer, PierreEditBoundary } from './EditableFileViewer';
import { HtmlFileViewer } from './HtmlFileViewer';
import { ImageFileViewer, SvgFileViewer } from './ImageFileViewer';

const PierreDiffViewer = lazy(() => import('./PierreDiffViewer'));

export type ViewerSelection =
  | { type: 'diff'; path: string; kind: 'staged' | 'unstaged' }
  | { type: 'conflict'; path: string }
  | { type: 'file'; path: string }
  | { type: 'commit'; oid: string; subject: string }
  | { type: 'commit-file'; oid: string; path: string; oldPath?: string | undefined }
  | { type: 'pull-request'; number: number }
  | null;

interface ViewerProps {
  repositoryId: string;
  selection: ViewerSelection;
  diffView: DiffViewPreference;
  wrapLines: boolean;
  theme: ThemePreference;
  revision: number;
  readOnly: boolean;
  commits: CommitInfo[];
  onSelect(selection: ViewerSelection): void;
  onDiffViewChange(value: DiffViewPreference): void;
  onWrapLinesChange(value: boolean): void;
  onDirtyChange(dirty: boolean): void;
  onUpdateConflict(path: string, content: string): Promise<boolean>;
  onResolveConflict(path: string, content: string): Promise<boolean>;
}

type ViewerData =
  | { docKey: string; type: 'diff'; value: DiffResult }
  | { docKey: string; type: 'file' | 'conflict'; value: FileResult }
  | { docKey: string; type: 'image'; value: ImageFileResult }
  | null;
// Commit contents are immutable per oid; only those selections are cached.
// Patches are JS strings, so two bytes per code unit is a practical upper-bound
// estimate. Oversized patches remain visible but bypass this cache entirely.
const diffCache = new ByteBudgetLru<string, DiffResult>({
  maxEntries: 8,
  maxBytes: 16 * 1024 * 1024,
  sizeOf: (value) => value.patch.length * 2 + value.path.length * 2 + 256,
});
let diffCacheRepositoryId: string | null = null;

export default function Viewer({ repositoryId, selection, diffView, wrapLines, theme, revision, readOnly, commits, onSelect, onDiffViewChange, onWrapLinesChange, onDirtyChange, onUpdateConflict, onResolveConflict }: ViewerProps) {
  const [data, setData] = useState<ViewerData>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowLarge, setAllowLarge] = useState(false);
  const requestToken = useRef(0);
  const fileDirty = useRef(false);
  const docKey = documentKey(repositoryId, selection);

  useEffect(() => {
    setAllowLarge(false);
    fileDirty.current = false;
    onDirtyChange(false);
  }, [onDirtyChange, selection]);

  useEffect(() => {
    if (diffCacheRepositoryId !== repositoryId) {
      diffCache.clear();
      diffCacheRepositoryId = repositoryId;
    }
    const token = ++requestToken.current;
    setError(null);
    // Pull request selections fetch their own data inside PullRequestViewer.
    if (!selection || selection.type === 'pull-request') { setData(null); setLoading(false); return; }
    setLoading(true);
    const run = async () => {
      try {
        if (selection.type === 'file' || selection.type === 'conflict') {
          if (selection.type === 'file' && isKnownImagePath(selection.path)) {
            const value = await window.justgit.repository.readImage(repositoryId, selection.path);
            if (token !== requestToken.current) return;
            setData({ docKey, type: 'image', value });
            return;
          }
          const value = await window.justgit.repository.readFile(repositoryId, selection.path, selection.type === 'conflict' ? true : allowLarge);
          if (token !== requestToken.current) return;
          if (selection.type === 'conflict') {
            setData({ docKey, type: 'conflict', value });
            return;
          }
          setData((current) => current && current.docKey === docKey && current.type === 'file'
            && fileDirty.current
            ? current
            : current && current.docKey === docKey && current.type === 'file'
            && current.value.content === value.content && current.value.size === value.size
            && current.value.binary === value.binary && current.value.tooLarge === value.tooLarge
            ? current
            : { docKey, type: 'file', value });
        } else {
          const immutable = selection.type !== 'diff';
          let value = immutable ? diffCache.get(docKey) : undefined;
          if (!value) {
            value = selection.type === 'commit'
              ? await window.justgit.diff.getCommit(repositoryId, selection.oid)
              : selection.type === 'commit-file'
                ? await window.justgit.diff.getCommitFile(repositoryId, selection.oid, selection.path, selection.oldPath)
                : await window.justgit.diff.get({ repositoryId, path: selection.path, kind: selection.kind });
            if (immutable) diffCache.set(docKey, value);
          }
          if (token !== requestToken.current) return;
          const next = value;
          setData((current) => current && current.docKey === docKey && current.type === 'diff'
            && current.value.patch === next.patch && current.value.binary === next.binary
            ? current
            : { docKey, type: 'diff', value: next });
        }
      } catch (reason) {
        if (token === requestToken.current) setError(reason instanceof Error ? reason.message : 'Could not load the viewer.');
      } finally {
        if (token === requestToken.current) setLoading(false);
      }
    };
    void run();
  }, [allowLarge, docKey, repositoryId, revision, selection]);

  const themeType = theme === 'system' ? 'system' : theme;
  const overflow = wrapLines ? 'wrap' : 'scroll';
  const handleFileDirtyChange = useCallback((dirty: boolean) => {
    fileDirty.current = dirty;
    onDirtyChange(dirty);
  }, [onDirtyChange]);
  const saveFile = useCallback(async (path: string, content: string, expectedContent: string): Promise<WriteFileResult> => {
    const result = await window.justgit.repository.writeFile(repositoryId, path, content, expectedContent);
    if (result.status === 'saved') {
      fileDirty.current = false;
      onDirtyChange(false);
      setData((current) => current?.type === 'file' && current.value.path === path
        ? {
          ...current,
          value: {
            ...current.value,
            content,
            binary: false,
            tooLarge: false,
            size: result.size,
            mtimeMs: result.mtimeMs,
          },
        }
        : current);
    }
    return result;
  }, [onDirtyChange, repositoryId]);
  // While a new document loads, the previous one stays on screen; the swap
  // animates when the fresh data arrives instead of blanking to a spinner.
  const reloading = loading && data !== null && !error;

  let content: React.ReactNode;
  let pierreContent: React.ReactNode = null;
  if (!selection) {
    content = <EmptyViewer />;
  } else if (selection.type === 'pull-request') {
    content = (
      <PullRequestViewer
        key={`${repositoryId}:${selection.number}`}
        repositoryId={repositoryId}
        prNumber={selection.number}
        diffView={diffView}
        themeType={themeType}
        wrapLines={wrapLines}
        onDiffViewChange={onDiffViewChange}
        onWrapLinesChange={onWrapLinesChange}
        onClose={() => onSelect(null)}
      />
    );
  } else if (error) {
    content = <div className="viewer-message text-destructive">{error}</div>;
  } else if (!data) {
    content = <div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading…" /></div>;
  } else if (data.type === 'image') {
    content = <ImageFileViewer key={`${data.value.path}:${data.value.mtimeMs}`} image={data.value} />;
  } else if (data.type !== 'diff' && data.value.binary) {
    content = <div className="viewer-message">Binary file · {formatBytes(data.value.size)}</div>;
  } else if (data.type === 'file' && data.value.tooLarge && !allowLarge) {
    content = (
      <div className="viewer-message flex-col gap-3">
        <p>The file is {formatBytes(data.value.size)}. Preview is limited to protect performance.</p>
        <Button variant="outline" onClick={() => setAllowLarge(true)}>Load preview</Button>
      </div>
    );
  } else if (data.type === 'file' && data.value.tooLarge) {
    content = <div className="viewer-message text-destructive">The file exceeds the built-in editor&apos;s 8 MB safety limit.</div>;
  } else if (data.type === 'conflict' && data.value.tooLarge) {
    content = <div className="viewer-message text-destructive">The conflicted file exceeds the viewer&apos;s safe limit. Open it in an external editor to resolve it.</div>;
  } else if (data.type === 'conflict') {
    content = null;
    pierreContent = (
      <Suspense fallback={<ViewerLoading />}>
        <PierreDiffViewer
          kind="conflict"
          contentKey={data.docKey}
          file={data.value}
          revision={revision}
          themeType={themeType}
          overflow={overflow}
          onUpdate={onUpdateConflict}
          onResolve={onResolveConflict}
        />
      </Suspense>
    );
  } else if (data.type === 'file' && isMarkdownPath(data.value.path)) {
    const file = data.value;
    content = (
      <MarkdownFileViewer
        key={`${file.path}:${file.mtimeMs}`}
        file={file}
        revision={revision}
        themeType={themeType}
        wrapLines={wrapLines}
        readOnly={readOnly || file.tooLarge}
        onDirtyChange={handleFileDirtyChange}
        onSave={saveFile}
      />
    );
  } else if (data.type === 'file' && isSvgPath(data.value.path)) {
    const file = data.value;
    content = (
      <SvgFileViewer
        key={`${file.path}:${file.mtimeMs}`}
        file={file}
        themeType={themeType}
        wrapLines={wrapLines}
        readOnly={readOnly || file.tooLarge}
        onDirtyChange={handleFileDirtyChange}
        onSave={saveFile}
      />
    );
  } else if (data.type === 'file' && isHtmlPath(data.value.path)) {
    const file = data.value;
    content = (
      <HtmlFileViewer
        key={`${file.path}:${file.mtimeMs}`}
        file={file}
        themeType={themeType}
        wrapLines={wrapLines}
        readOnly={readOnly || file.tooLarge}
        onDirtyChange={handleFileDirtyChange}
        onSave={saveFile}
      />
    );
  } else if (data.type === 'file') {
    const file = data.value;
    content = (
      <EditableFileViewer
        key={`${file.path}:${file.size}:${file.mtimeMs}`}
        file={file}
        themeType={themeType}
        wrapLines={wrapLines}
        readOnly={readOnly}
        onDirtyChange={handleFileDirtyChange}
        onSave={saveFile}
      />
    );
  } else if (data.type === 'diff' && data.value.patch) {
    const commitSelection = selection.type === 'commit' || selection.type === 'commit-file' ? selection : null;
    const commit = commitSelection ? commits.find((item) => item.oid === commitSelection.oid) : undefined;
    const scopeControl = selection.type === 'commit-file'
      ? <Button type="button" variant="outline" size="xs" onClick={() => onSelect({ type: 'commit', oid: selection.oid, subject: commit?.subject ?? selection.oid.slice(0, 8) })}>All files</Button>
      : undefined;
    content = null;
    pierreContent = (
      <div className={commitSelection ? 'commit-diff-viewer' : 'standalone-diff-viewer'}>
        {commitSelection && <CommitDiffHeader commit={commit} fallbackSubject={'subject' in commitSelection ? commitSelection.subject : ''} />}
        <Suspense fallback={<ViewerLoading />}>
          <PierreDiffViewer
            kind="diff"
            contentKey={data.docKey}
            value={data.value}
            diffView={diffView}
            themeType={themeType}
            wrapLines={wrapLines}
            initiallyCollapsed={selection.type === 'commit'}
            compact={selection.type === 'diff'}
            scopeControl={scopeControl}
            onDiffViewChange={onDiffViewChange}
            onWrapLinesChange={onWrapLinesChange}
            onClose={() => onSelect(null)}
          />
        </Suspense>
      </div>
    );
  } else if (data.type === 'diff') {
    content = <div className="viewer-message">No differences to show.</div>;
  } else {
    content = <div className="viewer-message">This file cannot be edited.</div>;
  }

  return (
    <PierreEditBoundary enabled={data?.type === 'file'}>
      {/* Keyed by the displayed document: the fade runs when new content lands, not while it loads. */}
      {pierreContent ?? <div key={data ? data.docKey : docKey} className="viewer-transition">{content}</div>}
      {reloading && <span className="viewer-reloading" aria-hidden="true"><IconLoader4 className="spinner" /></span>}
    </PierreEditBoundary>
  );
}

function CommitDiffHeader({ commit, fallbackSubject }: { commit: CommitInfo | undefined; fallbackSubject: string }) {
  const date = commit?.date ? new Date(commit.date) : null;
  return (
    <header className="commit-diff-header">
      <h2>{commit?.subject || fallbackSubject || '(no subject)'}</h2>
      <div className="commit-diff-meta">
        <code>{commit?.shortOid ?? 'commit'}</code>
        {commit?.author && <span>{commit.author}{commit.email ? ` <${commit.email}>` : ''}</span>}
        {date && Number.isFinite(date.getTime()) && <time dateTime={commit?.date} title={date.toLocaleString()}>{date.toLocaleString()}</time>}
        {commit?.parentCount && commit.parentCount > 1 ? <span>Merge commit</span> : null}
        {commit?.upstreamState === 'local-only' && <span className="commit-local-label">Local only</span>}
      </div>
    </header>
  );
}

function documentKey(repositoryId: string, selection: ViewerSelection): string {
  if (!selection) return `${repositoryId}:empty`;
  if (selection.type === 'pull-request') return `${repositoryId}:pull:${selection.number}`;
  if (selection.type === 'commit') return `${repositoryId}:commit:${selection.oid}`;
  if (selection.type === 'commit-file') return `${repositoryId}:commit-file:${selection.oid}:${selection.oldPath ?? ''}:${selection.path}`;
  if (selection.type === 'diff') return `${repositoryId}:diff:${selection.kind}:${selection.path}`;
  return `${repositoryId}:${selection.type}:${selection.path}`;
}

function ViewerLoading() {
  return <div className="viewer-message"><IconLoader4 className="spinner" /> <ShimmeringText text="Loading viewer…" /></div>;
}

function EmptyViewer() {
  return (
    <div className="viewer-empty">
      <h2>Nothing selected</h2>
      <p>Select a change, file, commit, or pull request.</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
