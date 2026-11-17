import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDiff, Virtualizer, useWorkerPool } from '@pierre/diffs/react';
import {
  IconArrowsMaximize, IconArrowsMinimize, IconChevronRight, IconFileArrowRight, IconHistory,
  IconLayoutColumns, IconLayoutRows, IconSearch, IconTextWrap, IconX,
} from '@tabler/icons-react';
import { isLargePullRequestFile, type DiffResult, type DiffViewPreference, type ThemePreference } from '@shared/contracts';
import type { ChangeKind, CommitFile } from '@shared/git-types';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/Reveal';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { useTruncatedText } from '@/lib/use-truncated-text';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { useParsedDiff } from './useParsedDiff';
import { FileHistoryContext } from '@/features/history/file-history-context';
import { primeDiffsWhenIdle } from './diff-idle-prime';
import { OPENTIG_CODE_THEMES } from './diffThemes';
import { ChangeStatusBadge } from '@/features/changes/ChangeStatusBadge';
import { animatesFileToggle, diffChangeKind, splitCommitPatch, type DiffFileEntry, VIEWER_SCROLLBAR_CSS } from './patch-utils';
import { resolvePierreLanguage } from './pierreLanguages';
import { ColorHoverPreview } from './ColorHoverPreview';
import { ColorSwatchLayer } from './ColorSwatchLayer';
import { createColorSwatchRegistry } from './color-swatch-registry';
import { noteViewState, rememberedFolds, rememberedKnown, rememberFolds, restoredViewState } from './viewer-memory';

/** A commit reads as one document: its message and files lead into its diffs. */
export interface DiffCommitLayout {
  /** Where the diff tools go, beside the commit's title instead of in a row of their own. */
  tools: HTMLElement | null;
  /** Scrolls away above the diffs. */
  lead: React.ReactNode;
  /** The whole commit is showing, so its file count and totals lead into the diffs. */
  listFiles: boolean;
}

// Past either limit a commit opens as collapsed rows, which are a list already,
// and only builds the diffs asked for.
const LARGE_COMMIT_FILES = 30;
const LARGE_COMMIT_LINES = 5_000;

interface DiffWorkspaceProps {
  contentKey: string;
  diff: DiffResult;
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  initiallyCollapsed?: boolean | undefined;
  /** Keeps which files were folded under this key, so the same diff opens again as it was left. */
  foldMemoryKey?: string | undefined;
  compact?: boolean | undefined;
  scopeControl?: React.ReactNode | undefined;
  commitLayout?: DiffCommitLayout | undefined;
  onDiffViewChange?: ((value: DiffViewPreference) => void) | undefined;
  onWrapLinesChange?: ((value: boolean) => void) | undefined;
  onClose?: (() => void) | undefined;
  /** Offers each file's current version in Files, from its header. */
  onOpenFile?: ((path: string) => void) | undefined;
}

export function DiffWorkspace(props: DiffWorkspaceProps) {
  return <DiffDocument key={props.contentKey} {...props} />;
}

type ParseMessage = { text: string; error: boolean } | null;

function DiffDocument(props: DiffWorkspaceProps) {
  const result = useParsedDiff(props.diff.patch, props.contentKey);
  const [lastParsed, setLastParsed] = useState<{ files: DiffFileEntry[]; diff: DiffResult } | null>(null);
  if (result?.files && result.files !== lastParsed?.files) setLastParsed({ files: result.files, diff: props.diff });
  const files = result?.files ?? lastParsed?.files;
  const diff = result?.files ? props.diff : lastParsed?.diff ?? props.diff;
  // A refresh that changes the patch keeps the revision on screen, where it can
  // still be read and scrolled, until the new one has been parsed. Only a first
  // parse has nothing to show, and only a failed one hides what was there.
  const message: ParseMessage = result?.error !== undefined ? { text: result.error, error: true }
    : !result && !files ? { text: 'Preparing diff…', error: false } : null;
  const phone = useMobileChrome() !== null;
  // Retain this document's mounted virtualizer and collapse choices during a refresh.
  if (files) return <ParsedDiffWorkspace {...props} diff={diff} files={files} message={message} />;
  return (
    <div className={`diff-workspace${props.compact ? ' compact' : ''}`}>
      <div className="diff-workspace-toolbar">
        {props.scopeControl}
        <span role={message?.error ? 'alert' : 'status'}>{message?.text}</span>
        {props.onClose && !phone && <DiffAction label="Close diff" onClick={props.onClose}><IconX /></DiffAction>}
      </div>
      {props.commitLayout && <div className="diff-workspace-scroll">{props.commitLayout.lead}</div>}
    </div>
  );
}

function ParsedDiffWorkspace({ contentKey, diff, diffView, themeType, wrapLines, initiallyCollapsed = false, foldMemoryKey, compact = false, scopeControl, commitLayout, onDiffViewChange, onWrapLinesChange, onClose, onOpenFile, files, message }: DiffWorkspaceProps & { files: DiffFileEntry[]; message: ParseMessage }) {
  const largeCommit = Boolean(commitLayout?.listFiles) && (files.length > LARGE_COMMIT_FILES || diff.lineCount > LARGE_COMMIT_LINES);
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => {
    const folded = initiallyCollapsed || largeCommit;
    const remembered = foldMemoryKey ? rememberedFolds(foldMemoryKey) : undefined;
    // A file the diff did not have when it was left opens as any new file does.
    if (remembered) return new Set(files.filter((file) => remembered.has(file.key) || (folded && !rememberedKnown(foldMemoryKey!, file.key))).map((file) => file.key));
    return new Set(folded ? files.map((file) => file.key) : []);
  });
  const setCollapsed = (update: (current: Set<string>) => Set<string>) => {
    setCollapsedState((current) => {
      const next = update(current);
      if (foldMemoryKey) rememberFolds(foldMemoryKey, next, files.map((file) => file.key));
      return next;
    });
  };
  // A phone reads inline, leaves through its back arrow, and has one screen to give to the code.
  const phone = useMobileChrome() !== null;
  const sections = useRef(new Map<string, HTMLElement>());
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [colorSwatches] = useState(createColorSwatchRegistry);
  const highlightPool = useWorkerPool();
  useEffect(() => primeDiffsWhenIdle(highlightPool, files.map((file) => file.fileDiff)), [files, highlightPool]);
  const allCollapsed = files.length > 0 && files.every((file) => collapsed.has(file.key));
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  const toggleFile = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAll = () => setCollapsed(() => allCollapsed ? new Set() : new Set(files.map((file) => file.key)));
  const diffActions = (includeCollapse: boolean) => (
    <div className="diff-workspace-actions">
      {includeCollapse && (
        <DiffAction label={allCollapsed ? 'Expand all files' : 'Collapse all files'} onClick={toggleAll}>
          {allCollapsed ? <IconArrowsMaximize /> : <IconArrowsMinimize />}
        </DiffAction>
      )}
      {!phone && <DiffAction label={diffView === 'unified' ? 'Use split diff' : 'Use unified diff'} pressed={diffView === 'split'} onClick={() => onDiffViewChange?.(diffView === 'unified' ? 'split' : 'unified')}>
        {diffView === 'unified' ? <IconLayoutColumns /> : <IconLayoutRows />}
      </DiffAction>}
      <DiffAction label={wrapLines ? 'Disable line wrapping' : 'Wrap long lines'} pressed={wrapLines} onClick={() => onWrapLinesChange?.(!wrapLines)}>
        <IconTextWrap />
      </DiffAction>
      {onClose && !phone && <DiffAction label="Close diff" onClick={onClose}><IconX /></DiffAction>}
    </div>
  );
  const toolbar = (commitLayout ? message : !compact || message) && <div className="diff-workspace-toolbar">
        {message ? <>
          {!commitLayout && scopeControl}
          <span role={message.error ? 'alert' : 'status'}>{message.text}</span>
          {onClose && !phone && <DiffAction label="Close diff" onClick={onClose}><IconX /></DiffAction>}
        </> : <>
          {scopeControl && <div className="diff-workspace-scope">{scopeControl}</div>}
          <span className="diff-file-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
          <span className="diff-total-stats" aria-label={`${additions} additions and ${deletions} deletions`}>
            <span className="add">+{additions}</span><span className="del">−{deletions}</span>
          </span>
          {diffActions(true)}
        </>}
      </div>;
  const toolbarScrollsAway = phone && !message;

  return (
    <div key={contentKey} ref={workspaceRef} className={`diff-workspace${compact ? ' compact' : ''}`}>
      <ColorHoverPreview getRoot={() => workspaceRef.current} swatches={colorSwatches} />
      {commitLayout?.tools && createPortal(<>{scopeControl}{diffActions(files.length > 1)}</>, commitLayout.tools)}
      {!toolbarScrollsAway && toolbar}
      <div style={{ display: 'contents' }} inert={message !== null} aria-hidden={message ? true : undefined}>
        <Virtualizer className="diff-workspace-scroll" contentClassName="diff-workspace-content" style={{ visibility: message ? 'hidden' : undefined }}>
          <ColorSwatchLayer registry={colorSwatches} />
          {toolbarScrollsAway && toolbar}
          {commitLayout && <div className="diff-workspace-lead">{commitLayout.lead}</div>}
          {/* Only the totals: each file's header follows, so a list of them would say it twice. */}
          {commitLayout?.listFiles && files.length > 1 && (
            <div className="diff-file-list">
              <div className="diff-file-count">{files.length} files · +{additions} −{deletions}</div>
            </div>
          )}
          {files.map((file) => {
            const isCollapsed = !compact && collapsed.has(file.key);
            return (
              <section key={file.key} ref={(element) => { if (element) sections.current.set(file.key, element); else sections.current.delete(file.key); }} className="diff-file-section" data-color-language={resolvePierreLanguage(file.path)}>
                {compact
                  ? phone
                    // The top bar already names a lone file and counts its lines, so all that's left to say is a rename.
                    ? files.length === 1 ? <RenamedFrom file={file} /> : <CompactFileHeader file={file} actions={null} />
                    : <CompactFileHeader file={file} actions={diffActions(false)} />
                  : <CollapsibleFileHeader file={headerFile(file)} collapsed={isCollapsed} onToggle={() => toggleFile(file.key)} onOpenFile={onOpenFile} />}
                <Reveal open={!isCollapsed} animate={animatesFileToggle(file, files.length)}>
                  <FileDiff
                    key={`${contentKey}:${file.key}:${diffView}:${wrapLines}`}
                    fileDiff={file.fileDiff}
                    options={{ diffStyle: diffView, diffIndicators: 'classic', themeType, theme: OPENTIG_CODE_THEMES, overflow: wrapLines ? 'wrap' : 'scroll', disableFileHeader: true, hunkSeparators: 'line-info-basic', unsafeCSS: VIEWER_SCROLLBAR_CSS }}
                  />
                </Reveal>
              </section>
            );
          })}
        </Virtualizer>
      </div>
    </div>
  );
}

function diffPathParts(path: string): { name: string; directory: string } {
  const normalized = path.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  return slash < 0
    ? { name: normalized, directory: '' }
    : { name: normalized.slice(slash + 1), directory: normalized.slice(0, slash) };
}

function DiffFileIcon({ path }: { path: string }) {
  return <img className="vscode-tree-icon" src={getVsCodeFileIconUrl(path)} alt="" aria-hidden="true" draggable={false} />;
}

function DiffFilePathLabel({ path }: { path: string }) {
  const { name, directory } = diffPathParts(path);
  return (
    <>
      {directory ? <span className="diff-file-directory">{directory}/</span> : null}
      <span className="diff-file-name">{name}</span>
    </>
  );
}

/** What a file's header says, whether it comes from a parsed patch or from a commit's file list. */
interface HeaderFile {
  path: string;
  previousPath?: string | null | undefined;
  additions: number;
  deletions: number;
  binary: boolean;
  kind: ChangeKind;
}

const headerFile = (file: DiffFileEntry): HeaderFile => ({ ...file, kind: diffChangeKind(file.changeType) });

function FileHeaderFacts({ file }: { file: HeaderFile }) {
  return (
    <>
      {file.previousPath && file.previousPath !== file.path && <span className="diff-file-previous">from {file.previousPath}</span>}
      <span className="diff-file-stats">
        {/* A side with nothing on it is left out, so a deletion reads "−12" and not "+0 −12". */}
        {file.binary ? <span className="binary">bin</span> : (
          <>
            {file.additions > 0 && <span className="add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="del">−{file.deletions}</span>}
          </>
        )}
      </span>
      <ChangeStatusBadge kind={file.kind} />
    </>
  );
}

function RenamedFrom({ file }: { file: DiffFileEntry }) {
  if (!file.previousPath || file.previousPath === file.path) return null;
  return <div className="diff-file-header diff-file-header-compact"><span className="diff-file-previous">Renamed from {file.previousPath}</span></div>;
}

function CompactFileHeader({ file, actions }: { file: DiffFileEntry; actions: React.ReactNode }) {
  const [pathRef, truncated] = useTruncatedText(file.path);
  return (
    <div className="diff-file-header diff-file-header-compact">
      <DiffFileIcon path={file.path} />
      <Tooltip disabled={!truncated}>
        <TooltipTrigger render={<span ref={pathRef} className="diff-file-path" />}><DiffFilePathLabel path={file.path} /></TooltipTrigger>
        <TooltipContent>{file.path}</TooltipContent>
      </Tooltip>
      <FileHeaderFacts file={headerFile(file)} />
      {actions}
    </div>
  );
}

/**
 * The row toggles the file, and its button is what keyboards and screen readers
 * reach. Opening the file is a button of its own beside the name.
 */
function CollapsibleFileHeader({ file, size = null, collapsed, onToggle, onOpenFile }: { file: HeaderFile; size?: string | null; collapsed: boolean; onToggle(): void; onOpenFile?: ((path: string) => void) | undefined }) {
  const [pathRef, truncated] = useTruncatedText(file.path);
  // A deleted file has nothing left to open, nor a history to start from here.
  const canOpen = onOpenFile && file.kind !== 'deleted';
  // A phone's header has no room for it: its top bar's menu offers it instead.
  const openHistory = useContext(FileHistoryContext);
  const phone = useMobileChrome() !== null;
  return (
    <div className="diff-file-header" onClick={(event) => { if (!(event.target as Element).closest('button')) onToggle(); }}>
      <Tooltip disabled={!truncated}>
        <TooltipTrigger render={<button type="button" className="diff-file-toggle" aria-expanded={!collapsed} onClick={onToggle} />}>
          <IconChevronRight className={`diff-file-chevron folder-chevron${collapsed ? '' : ' open'}`} />
          <DiffFileIcon path={file.path} />
          <span ref={pathRef} className="diff-file-path"><DiffFilePathLabel path={file.path} /></span>
        </TooltipTrigger>
        <TooltipContent anchor={pathRef}>{file.path}</TooltipContent>
      </Tooltip>
      {canOpen && <DiffAction label="Open file" className="diff-file-open" onClick={() => onOpenFile(file.path)}><IconFileArrowRight /></DiffAction>}
      {canOpen && openHistory && !phone && <DiffAction label="File history" className="diff-file-open" onClick={() => openHistory(file.path)}><IconHistory /></DiffAction>}
      <span className="diff-file-header-gap" />
      {size && <span className="diff-file-size">Large file · {size}</span>}
      <FileHeaderFacts file={file} />
    </div>
  );
}

function DiffAction({ label, pressed, className, onClick, children }: { label: string; pressed?: boolean; className?: string; onClick(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" className={className} aria-label={label} aria-pressed={pressed} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface CommitFilesWorkspaceProps {
  contentKey: string;
  /** The files the commit changed, from its file list: no diff is read until a file unfolds. */
  files: readonly CommitFile[];
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  commitLayout: DiffCommitLayout;
  /** One file's diff. The same read serves the file opened on its own. */
  readFile(file: CommitFile, signal: AbortSignal, urgent: boolean): Promise<DiffResult>;
  /** Every file's diff in one read, for unfolding them all: one request instead of one per file. */
  readAll(signal: AbortSignal): Promise<DiffResult>;
  /** Puts one file's part of that read where `readFile` finds it. */
  keepFileDiff(file: CommitFile, diff: DiffResult): void;
  onDiffViewChange?: ((value: DiffViewPreference) => void) | undefined;
  onWrapLinesChange?: ((value: boolean) => void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
}

/** A file listed before its diff is read; a pull request's also says how large it is. */
export type ListedFile = CommitFile & { size?: number | null };

const commitFileKey = (file: CommitFile) => `${file.oldPath ?? ''}:${file.path}`;

/**
 * A whole commit as a list of its files, each unfolding into its diff. Only the
 * list is read when the commit opens; a file's diff is read when it unfolds, and
 * a read whose file folds again or whose commit closes is called off.
 */
export function CommitFilesWorkspace({ commitLayout, ...props }: CommitFilesWorkspaceProps) {
  return <FilesWorkspace {...props} layout={{ kind: 'commit', ...commitLayout }} />;
}

interface PullRequestFilesWorkspaceProps {
  contentKey: string;
  files: readonly ListedFile[];
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  /** Before the file count in the toolbar, such as All changes and By commit. */
  scopeControl: React.ReactNode;
  /** Under the toolbar, such as how many files were left out of the list. */
  notice?: React.ReactNode;
  /** Keeps which files were unfolded under this key, so the same code opens again as it was left. */
  foldMemoryKey: string;
  /** One file's diff; `urgent` when the user unfolded that file alone. */
  readFile(file: ListedFile, signal: AbortSignal, urgent: boolean): Promise<DiffResult>;
  onDiffViewChange?: ((value: DiffViewPreference) => void) | undefined;
  onWrapLinesChange?: ((value: boolean) => void) | undefined;
  onClose?: (() => void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
}

/**
 * A pull request's code as a list of its files that a filter narrows, each
 * unfolding into its diff, read when it unfolds. Expand all reads the files it
 * unfolds a few at a time, and leaves large ones folded: each says its size and
 * is read only when unfolded alone.
 */
export function PullRequestFilesWorkspace({ scopeControl, notice, onClose, ...props }: PullRequestFilesWorkspaceProps) {
  return <FilesWorkspace {...props} layout={{ kind: 'toolbar', scopeControl, notice, onClose }} />;
}

type FilesLayout =
  | ({ kind: 'commit' } & DiffCommitLayout)
  | { kind: 'toolbar'; scopeControl: React.ReactNode; notice: React.ReactNode; onClose: (() => void) | undefined };

/**
 * What Expand all reads at most, by the files' sizes: about what the whole diff of a pull request could
 * be before it was read file by file, so unfolding everything never holds much more than that did.
 */
const EXPAND_ALL_BYTES = 4 * 1024 * 1024;
/** Lines of a file whose size is not known, at a generous width. */
const BYTES_PER_LINE = 80;

/** The first files, in order, whose sizes together stay within what Expand all reads. */
function withinExpandBudget(files: readonly ListedFile[]): ListedFile[] {
  let total = 0;
  const kept: ListedFile[] = [];
  for (const file of files) {
    total += file.size ?? (file.additions + file.deletions) * BYTES_PER_LINE;
    if (total > EXPAND_ALL_BYTES) break;
    kept.push(file);
  }
  return kept;
}

/** A file's size as its header says it. */
function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function FilesWorkspace({ contentKey, files, diffView, themeType, wrapLines, layout, foldMemoryKey, readFile, readAll, keepFileDiff, onDiffViewChange, onWrapLinesChange, onOpenFile }: {
  contentKey: string; files: readonly ListedFile[]; diffView: DiffViewPreference; themeType: ThemePreference; wrapLines: boolean; layout: FilesLayout;
  foldMemoryKey?: string | undefined;
  readFile(file: ListedFile, signal: AbortSignal, urgent: boolean): Promise<DiffResult>;
  readAll?: ((signal: AbortSignal) => Promise<DiffResult>) | undefined;
  keepFileDiff?: ((file: CommitFile, diff: DiffResult) => void) | undefined;
  onDiffViewChange?: ((value: DiffViewPreference) => void) | undefined;
  onWrapLinesChange?: ((value: boolean) => void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
}) {
  const pullRequest = layout.kind === 'toolbar';
  // A pull request remembers its unfolded files whenever it opens again, as its tab; a commit only for Back,
  // opening anew with every file folded.
  const [unfolded, setUnfoldedState] = useState<ReadonlySet<string>>(() => {
    const keys = new Set(files.map(commitFileKey));
    if (foldMemoryKey) {
      const folded = rememberedFolds(foldMemoryKey);
      return new Set(folded ? [...keys].filter((key) => !folded.has(key) && rememberedKnown(foldMemoryKey, key)) : []);
    }
    const restored = restoredViewState(contentKey);
    if (!Array.isArray(restored)) return new Set();
    return new Set(restored.filter((key): key is string => typeof key === 'string' && keys.has(key)));
  });
  const setUnfolded = (update: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>)) => setUnfoldedState((current) => {
    const next = typeof update === 'function' ? update(current) : update;
    if (foldMemoryKey) {
      const keys = files.map(commitFileKey);
      rememberFolds(foldMemoryKey, new Set(keys.filter((key) => !next.has(key))), keys);
    } else noteViewState(contentKey, [...next].slice(0, 500));
    return next;
  });
  /** Files unfolded on their own, whose reads go ahead of those Expand all asked for. */
  const asked = useRef(new Set<string>());
  // Unfolding everything reads the whole patch once; each file waits for it rather than asking on its own.
  const [everything, setEverything] = useState<Promise<void> | null>(null);
  const everythingController = useRef<AbortController | null>(null);
  useEffect(() => () => everythingController.current?.abort(), []);
  const [filter, setFilter] = useState('');
  const phone = useMobileChrome() !== null;
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [colorSwatches] = useState(createColorSwatchRegistry);
  const large = (file: ListedFile) => pullRequest && isLargePullRequestFile({ size: file.size ?? null, additions: file.additions, deletions: file.deletions });
  const needle = filter.trim().toLowerCase();
  const shown = needle ? files.filter((file) => file.path.toLowerCase().includes(needle) || file.oldPath?.toLowerCase().includes(needle)) : files;
  // Large files stay folded under Expand all, so it is about the others, and only as many of them as its
  // budget holds, in the list's order; the rest stay folded, each still unfolded by hand.
  const candidates = shown.filter((file) => !large(file));
  const expandable = pullRequest ? withinExpandBudget(candidates) : candidates;
  const heldBack = candidates.length - expandable.length;
  const allUnfolded = expandable.length > 0 && expandable.every((file) => unfolded.has(commitFileKey(file)));
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  const toggleFile = (key: string) => setUnfolded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else {
      next.add(key);
      asked.current.add(key);
    }
    return next;
  });
  const toggleAll = () => {
    const keys = shown.map(commitFileKey);
    if (allUnfolded) {
      setUnfolded((current) => new Set([...current].filter((key) => !keys.includes(key))));
      return;
    }
    if (readAll && keepFileDiff && !everything) {
      const controller = new AbortController();
      everythingController.current = controller;
      setEverything(readAll(controller.signal).then((whole) => {
        for (const [index, diff] of splitCommitPatch(whole, files).entries()) if (diff) keepFileDiff(files[index]!, diff);
      }).catch(() => undefined));
    }
    for (const key of keys) asked.current.delete(key);
    setUnfolded((current) => new Set([...current, ...expandable.map(commitFileKey)]));
  };
  const actions = (
    <div className="diff-workspace-actions">
      {(pullRequest ? expandable.length > 0 : files.length > 1) && (
        <DiffAction label={allUnfolded ? 'Collapse all files' : 'Expand all files'} onClick={toggleAll}>
          {allUnfolded ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
        </DiffAction>
      )}
      {!phone && <DiffAction label={diffView === 'unified' ? 'Use split diff' : 'Use unified diff'} pressed={diffView === 'split'} onClick={() => onDiffViewChange?.(diffView === 'unified' ? 'split' : 'unified')}>
        {diffView === 'unified' ? <IconLayoutColumns /> : <IconLayoutRows />}
      </DiffAction>}
      <DiffAction label={wrapLines ? 'Disable line wrapping' : 'Wrap long lines'} pressed={wrapLines} onClick={() => onWrapLinesChange?.(!wrapLines)}>
        <IconTextWrap />
      </DiffAction>
      {layout.kind === 'toolbar' && layout.onClose && !phone && <DiffAction label="Close diff" onClick={layout.onClose}><IconX /></DiffAction>}
    </div>
  );
  const filterField = pullRequest && files.length > 1 && (
    <label className="diff-file-filter">
      <IconSearch aria-hidden="true" />
      <input type="search" value={filter} placeholder="Filter files" aria-label="Filter files" autoComplete="off" spellCheck={false}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape' && filter) { event.stopPropagation(); setFilter(''); } }} />
    </label>
  );
  const toolbar = layout.kind === 'toolbar' && (
    <div className="diff-workspace-toolbar">
      {layout.scopeControl && <div className="diff-workspace-scope">{layout.scopeControl}</div>}
      {filterField}
      <span className="diff-file-count">{needle ? `${shown.length} of ${files.length}` : files.length} {files.length === 1 ? 'file' : 'files'}</span>
      <span className="diff-total-stats" aria-label={`${additions} additions and ${deletions} deletions`}>
        <span className="add">+{additions}</span><span className="del">−{deletions}</span>
      </span>
      {actions}
    </div>
  );
  // A phone gives the code the screen: the toolbar scrolls away with it.
  const toolbarScrollsAway = phone && layout.kind === 'toolbar';

  return (
    <div key={contentKey} ref={workspaceRef} className="diff-workspace">
      <ColorHoverPreview getRoot={() => workspaceRef.current} swatches={colorSwatches} />
      {layout.kind === 'commit' && layout.tools && createPortal(actions, layout.tools)}
      {!toolbarScrollsAway && toolbar}
      <Virtualizer className="diff-workspace-scroll" contentClassName="diff-workspace-content">
        <ColorSwatchLayer registry={colorSwatches} />
        {toolbarScrollsAway && toolbar}
        {layout.kind === 'toolbar' && layout.notice}
        {allUnfolded && heldBack > 0 && (
          <p className="pr-files-omitted" role="status">
            {heldBack} more {heldBack === 1 ? 'file was' : 'files were'} left folded, so Expand all reads at most {sizeLabel(EXPAND_ALL_BYTES)}. Unfold {heldBack === 1 ? 'it' : 'them'} one by one to read {heldBack === 1 ? 'it' : 'them'}.
          </p>
        )}
        {layout.kind === 'commit' && <div className="diff-workspace-lead">{layout.lead}</div>}
        {layout.kind === 'commit' && files.length > 1 && (
          <div className="diff-file-list">
            <div className="diff-file-count">{files.length} files · +{additions} −{deletions}</div>
          </div>
        )}
        {needle && shown.length === 0 && <div className="diff-file-loading" role="status">No files match “{filter.trim()}”.</div>}
        {shown.map((file) => {
          const key = commitFileKey(file);
          const open = unfolded.has(key);
          const isLarge = large(file);
          return (
            <section key={key} className="diff-file-section" data-color-language={resolvePierreLanguage(file.path)}>
              <CollapsibleFileHeader
                file={{ path: file.path, previousPath: file.oldPath, additions: file.additions, deletions: file.deletions, binary: file.binary, kind: file.kind }}
                size={isLarge && file.size ? sizeLabel(file.size) : null}
                collapsed={!open}
                onToggle={() => toggleFile(key)}
                onOpenFile={onOpenFile}
              />
              <Reveal open={open} animate={!isLarge && animatesFileToggle(file, files.length)}>
                {pullRequest && file.binary
                  ? <div className="diff-file-loading">{file.path.split('/').pop()} is a binary file, so it has no diff to show.</div>
                  : <CommitFileDiff
                    contentKey={`${contentKey}:${key}`}
                    file={file}
                    fileKey={key}
                    asked={asked}
                    everything={everything}
                    readFile={readFile}
                    diffView={diffView}
                    themeType={themeType}
                    wrapLines={wrapLines}
                  />}
              </Reveal>
            </section>
          );
        })}
      </Virtualizer>
    </div>
  );
}

function CommitFileDiff({ contentKey, file, fileKey, asked, everything, readFile, diffView, themeType, wrapLines }: {
  contentKey: string; file: ListedFile; fileKey: string;
  /** Files unfolded on their own, whose reads go first. */
  asked: React.RefObject<Set<string>>;
  everything: Promise<void> | null; readFile(file: ListedFile, signal: AbortSignal, urgent: boolean): Promise<DiffResult>;
  diffView: DiffViewPreference; themeType: ThemePreference; wrapLines: boolean;
}) {
  const [state, setState] = useState<{ diff: DiffResult } | { error: string } | null>(null);
  useEffect(() => {
    // Whether it was unfolded alone only orders the read.
    const urgent = asked.current.has(fileKey);
    const controller = new AbortController();
    void (async () => {
      try {
        await everything;
        const diff = await readFile(file, controller.signal, urgent);
        if (!controller.signal.aborted) setState({ diff });
      } catch (reason) {
        if (!controller.signal.aborted) setState({ error: reason instanceof Error ? reason.message : 'Could not load the diff.' });
      }
    })();
    // A file folded again, or a commit closed, before its diff came back stops reading it.
    return () => controller.abort();
  }, [asked, everything, file, fileKey, readFile]);
  if (!state) return <div className="diff-file-loading" role="status"><Spinner className="view-spinner" /> <ShimmeringText text="Loading diff…" /></div>;
  if ('error' in state) return <div className="diff-file-loading text-destructive" role="alert">{state.error}</div>;
  // Larger than one response can carry: said by name, rather than shown as nothing.
  if (state.diff.truncated && !state.diff.patch) return <div className="diff-file-loading" role="status">{file.path}’s diff is too large to show here{file.size ? ` (${sizeLabel(file.size)})` : ''}.</div>;
  return <ParsedCommitFileDiff contentKey={contentKey} diff={state.diff} diffView={diffView} themeType={themeType} wrapLines={wrapLines} />;
}

function ParsedCommitFileDiff({ contentKey, diff, diffView, themeType, wrapLines }: { contentKey: string; diff: DiffResult; diffView: DiffViewPreference; themeType: ThemePreference; wrapLines: boolean }) {
  const result = useParsedDiff(diff.patch, contentKey);
  const highlightPool = useWorkerPool();
  const parsed = result?.files?.[0];
  useEffect(() => primeDiffsWhenIdle(highlightPool, parsed ? [parsed.fileDiff] : []), [highlightPool, parsed]);
  if (result?.error !== undefined) return <div className="diff-file-loading text-destructive" role="alert">{result.error}</div>;
  if (!result) return <div className="diff-file-loading" role="status"><Spinner className="view-spinner" /> <ShimmeringText text="Preparing diff…" /></div>;
  if (!parsed) return <div className="diff-file-loading">No differences to show.</div>;
  return (
    <FileDiff
      key={`${contentKey}:${diffView}:${wrapLines}`}
      fileDiff={parsed.fileDiff}
      options={{ diffStyle: diffView, diffIndicators: 'classic', themeType, theme: OPENTIG_CODE_THEMES, overflow: wrapLines ? 'wrap' : 'scroll', disableFileHeader: true, hunkSeparators: 'line-info-basic', unsafeCSS: VIEWER_SCROLLBAR_CSS }}
    />
  );
}

