import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDiff, Virtualizer, useWorkerPool } from '@pierre/diffs/react';
import {
  IconArrowsMaximize, IconArrowsMinimize, IconChevronRight, IconFileArrowRight, IconHistory,
  IconLayoutColumns, IconLayoutRows, IconTextWrap, IconX,
} from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, ThemePreference } from '@shared/contracts';
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
import { rememberedFolds, rememberedKnown, rememberFolds } from './viewer-memory';

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
function CollapsibleFileHeader({ file, collapsed, onToggle, onOpenFile }: { file: HeaderFile; collapsed: boolean; onToggle(): void; onOpenFile?: ((path: string) => void) | undefined }) {
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
  readFile(file: CommitFile, signal: AbortSignal): Promise<DiffResult>;
  /** Every file's diff in one read, for unfolding them all: one request instead of one per file. */
  readAll(signal: AbortSignal): Promise<DiffResult>;
  /** Puts one file's part of that read where `readFile` finds it. */
  keepFileDiff(file: CommitFile, diff: DiffResult): void;
  onDiffViewChange?: ((value: DiffViewPreference) => void) | undefined;
  onWrapLinesChange?: ((value: boolean) => void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
}

const commitFileKey = (file: CommitFile) => `${file.oldPath ?? ''}:${file.path}`;

/**
 * A whole commit as a list of its files, each unfolding into its diff. Only the
 * list is read when the commit opens; a file's diff is read when it unfolds, and
 * a read whose file folds again or whose commit closes is called off.
 */
export function CommitFilesWorkspace({ contentKey, files, diffView, themeType, wrapLines, commitLayout, readFile, readAll, keepFileDiff, onDiffViewChange, onWrapLinesChange, onOpenFile }: CommitFilesWorkspaceProps) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  // Unfolding everything reads the whole patch once; each file waits for it rather than asking on its own.
  const [everything, setEverything] = useState<Promise<void> | null>(null);
  const everythingController = useRef<AbortController | null>(null);
  useEffect(() => () => everythingController.current?.abort(), []);
  const phone = useMobileChrome() !== null;
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [colorSwatches] = useState(createColorSwatchRegistry);
  const allUnfolded = files.length > 0 && files.every((file) => unfolded.has(commitFileKey(file)));
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  const toggleFile = (key: string) => setUnfolded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleAll = () => {
    if (allUnfolded) {
      setUnfolded(new Set());
      return;
    }
    if (!everything) {
      const controller = new AbortController();
      everythingController.current = controller;
      setEverything(readAll(controller.signal).then((whole) => {
        for (const [index, diff] of splitCommitPatch(whole, files).entries()) if (diff) keepFileDiff(files[index]!, diff);
      }).catch(() => undefined));
    }
    setUnfolded(new Set(files.map(commitFileKey)));
  };
  const tools = (
    <div className="diff-workspace-actions">
      {files.length > 1 && (
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
    </div>
  );

  return (
    <div key={contentKey} ref={workspaceRef} className="diff-workspace">
      <ColorHoverPreview getRoot={() => workspaceRef.current} swatches={colorSwatches} />
      {commitLayout.tools && createPortal(tools, commitLayout.tools)}
      <Virtualizer className="diff-workspace-scroll" contentClassName="diff-workspace-content">
        <ColorSwatchLayer registry={colorSwatches} />
        <div className="diff-workspace-lead">{commitLayout.lead}</div>
        {files.length > 1 && (
          <div className="diff-file-list">
            <div className="diff-file-count">{files.length} files · +{additions} −{deletions}</div>
          </div>
        )}
        {files.map((file) => {
          const key = commitFileKey(file);
          const open = unfolded.has(key);
          return (
            <section key={key} className="diff-file-section" data-color-language={resolvePierreLanguage(file.path)}>
              <CollapsibleFileHeader
                file={{ path: file.path, previousPath: file.oldPath, additions: file.additions, deletions: file.deletions, binary: file.binary, kind: file.kind }}
                collapsed={!open}
                onToggle={() => toggleFile(key)}
                onOpenFile={onOpenFile}
              />
              <Reveal open={open} animate={animatesFileToggle(file, files.length)}>
                <CommitFileDiff
                  contentKey={`${contentKey}:${key}`}
                  file={file}
                  everything={everything}
                  readFile={readFile}
                  diffView={diffView}
                  themeType={themeType}
                  wrapLines={wrapLines}
                />
              </Reveal>
            </section>
          );
        })}
      </Virtualizer>
    </div>
  );
}

function CommitFileDiff({ contentKey, file, everything, readFile, diffView, themeType, wrapLines }: {
  contentKey: string; file: CommitFile; everything: Promise<void> | null; readFile: CommitFilesWorkspaceProps['readFile'];
  diffView: DiffViewPreference; themeType: ThemePreference; wrapLines: boolean;
}) {
  const [state, setState] = useState<{ diff: DiffResult } | { error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await everything;
        const diff = await readFile(file, controller.signal);
        if (!controller.signal.aborted) setState({ diff });
      } catch (reason) {
        if (!controller.signal.aborted) setState({ error: reason instanceof Error ? reason.message : 'Could not load the diff.' });
      }
    })();
    // A file folded again, or a commit closed, before its diff came back stops reading it.
    return () => controller.abort();
  }, [everything, file, readFile]);
  if (!state) return <div className="diff-file-loading" role="status"><Spinner className="view-spinner" /> <ShimmeringText text="Loading diff…" /></div>;
  if ('error' in state) return <div className="diff-file-loading text-destructive" role="alert">{state.error}</div>;
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

