import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDiff, Virtualizer } from '@pierre/diffs/react';
import {
  IconArrowsMaximize, IconArrowsMinimize, IconChevronRight, IconFileArrowRight,
  IconLayoutColumns, IconLayoutRows, IconTextWrap, IconX,
} from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, ThemePreference } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/Reveal';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { useTruncatedText } from '@/lib/use-truncated-text';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { useParsedDiff } from './useParsedDiff';
import { OPENTIG_CODE_THEMES } from './diffThemes';
import { animatesFileToggle, type DiffFileEntry, VIEWER_SCROLLBAR_CSS } from './patch-utils';
import { resolvePierreLanguage } from './pierreLanguages';
import { ColorHoverPreview } from './ColorHoverPreview';
import { ColorSwatchLayer } from './ColorSwatchLayer';
import { createColorSwatchRegistry } from './color-swatch-registry';

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
  const message: ParseMessage = !result ? { text: 'Preparing diff…', error: false }
    : result.error !== undefined ? { text: result.error, error: true } : null;
  const phone = useMobileChrome() !== null;
  // Retain this document's mounted virtualizer and collapse choices during a
  // refresh. Its old revision stays invisible and inert until parsing finishes.
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

function ParsedDiffWorkspace({ contentKey, diff, diffView, themeType, wrapLines, initiallyCollapsed = false, compact = false, scopeControl, commitLayout, onDiffViewChange, onWrapLinesChange, onClose, onOpenFile, files, message }: DiffWorkspaceProps & { files: DiffFileEntry[]; message: ParseMessage }) {
  const largeCommit = Boolean(commitLayout?.listFiles) && (files.length > LARGE_COMMIT_FILES || diff.lineCount > LARGE_COMMIT_LINES);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(initiallyCollapsed || largeCommit ? files.map((file) => file.key) : []),
  );
  // A phone reads inline, leaves through its back arrow, and has one screen to give to the code.
  const phone = useMobileChrome() !== null;
  const sections = useRef(new Map<string, HTMLElement>());
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [colorSwatches] = useState(createColorSwatchRegistry);
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
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(files.map((file) => file.key)));
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
                  : <CollapsibleFileHeader file={file} collapsed={isCollapsed} onToggle={() => toggleFile(file.key)} onOpenFile={onOpenFile} />}
                <Reveal open={!isCollapsed} animate={animatesFileToggle(file, files.length)}>
                  <FileDiff
                    key={`${contentKey}:${file.key}:${diffView}:${wrapLines}`}
                    fileDiff={file.fileDiff}
                    disableWorkerPool={diff.lineCount > 10_000}
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

function FileHeaderFacts({ file }: { file: DiffFileEntry }) {
  return (
    <>
      {file.previousPath && file.previousPath !== file.path && <span className="diff-file-previous">from {file.previousPath}</span>}
      <span className="diff-file-stats"><span className="add">+{file.additions}</span><span className="del">−{file.deletions}</span></span>
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
      <FileHeaderFacts file={file} />
      {actions}
    </div>
  );
}

/**
 * The row toggles the file, and its button is what keyboards and screen readers
 * reach. Opening the file is a button of its own beside the name.
 */
function CollapsibleFileHeader({ file, collapsed, onToggle, onOpenFile }: { file: DiffFileEntry; collapsed: boolean; onToggle(): void; onOpenFile?: ((path: string) => void) | undefined }) {
  const [pathRef, truncated] = useTruncatedText(file.path);
  // A deleted file has nothing left to open.
  const canOpen = onOpenFile && file.changeType !== 'deleted';
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
