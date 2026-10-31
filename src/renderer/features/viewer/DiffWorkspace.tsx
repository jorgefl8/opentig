import { useState } from 'react';
import { FileDiff, Virtualizer } from '@pierre/diffs/react';
import {
  IconArrowsMaximize, IconArrowsMinimize, IconChevronDown, IconChevronRight,
  IconLayoutColumns, IconLayoutRows, IconTextWrap, IconX,
} from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, ThemePreference } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTruncatedText } from '@/lib/use-truncated-text';
import { useParsedDiff } from './useParsedDiff';
import { OPENTIG_CODE_THEMES } from './diffThemes';
import { type DiffFileEntry, VIEWER_SCROLLBAR_CSS } from './patch-utils';

interface DiffWorkspaceProps {
  contentKey: string;
  diff: DiffResult;
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  initiallyCollapsed?: boolean | undefined;
  compact?: boolean | undefined;
  scopeControl?: React.ReactNode | undefined;
  onDiffViewChange?: ((value: DiffViewPreference) => void) | undefined;
  onWrapLinesChange?: ((value: boolean) => void) | undefined;
  onClose?: (() => void) | undefined;
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
  // Retain this document's mounted virtualizer and collapse choices during a
  // refresh. Its old revision stays invisible and inert until parsing finishes.
  if (files) return <ParsedDiffWorkspace {...props} diff={diff} files={files} message={message} />;
  return (
    <div className={`diff-workspace${props.compact ? ' compact' : ''}`}>
      <div className="diff-workspace-toolbar">
        {props.scopeControl}
        <span role={message?.error ? 'alert' : 'status'}>{message?.text}</span>
        {props.onClose && <DiffAction label="Close diff" onClick={props.onClose}><IconX /></DiffAction>}
      </div>
    </div>
  );
}

function ParsedDiffWorkspace({ contentKey, diff, diffView, themeType, wrapLines, initiallyCollapsed = false, compact = false, scopeControl, onDiffViewChange, onWrapLinesChange, onClose, files, message }: DiffWorkspaceProps & { files: DiffFileEntry[]; message: ParseMessage }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(initiallyCollapsed ? files.map((file) => file.key) : []),
  );
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
      <DiffAction label={diffView === 'unified' ? 'Use split diff' : 'Use unified diff'} pressed={diffView === 'split'} onClick={() => onDiffViewChange?.(diffView === 'unified' ? 'split' : 'unified')}>
        {diffView === 'unified' ? <IconLayoutColumns /> : <IconLayoutRows />}
      </DiffAction>
      <DiffAction label={wrapLines ? 'Disable line wrapping' : 'Wrap long lines'} pressed={wrapLines} onClick={() => onWrapLinesChange?.(!wrapLines)}>
        <IconTextWrap />
      </DiffAction>
      {onClose && <DiffAction label="Close diff" onClick={onClose}><IconX /></DiffAction>}
    </div>
  );

  return (
    <div key={contentKey} className={`diff-workspace${compact ? ' compact' : ''}`}>
      {(!compact || message) && <div className="diff-workspace-toolbar">
        {message ? <>
          {scopeControl}
          <span role={message.error ? 'alert' : 'status'}>{message.text}</span>
          {onClose && <DiffAction label="Close diff" onClick={onClose}><IconX /></DiffAction>}
        </> : <>
          {scopeControl && <div className="diff-workspace-scope">{scopeControl}</div>}
          <span className="diff-file-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
          <span className="diff-total-stats" aria-label={`${additions} additions and ${deletions} deletions`}>
            <span className="add">+{additions}</span><span className="del">−{deletions}</span>
          </span>
          {diffActions(true)}
        </>}
      </div>}
      <div style={{ display: 'contents' }} inert={message !== null} aria-hidden={message ? true : undefined}>
        <Virtualizer className="diff-workspace-scroll" contentClassName="diff-workspace-content" style={{ visibility: message ? 'hidden' : undefined }}>
          {files.map((file) => {
            const isCollapsed = !compact && collapsed.has(file.key);
            return (
              <section key={file.key} className="diff-file-section">
                {compact
                  ? <CompactFileHeader file={file} actions={diffActions(false)} />
                  : <CollapsibleFileHeader file={file} collapsed={isCollapsed} onToggle={() => toggleFile(file.key)} />}
                {!isCollapsed && (
                  <FileDiff
                    key={`${contentKey}:${file.key}:${diffView}:${wrapLines}`}
                    fileDiff={file.fileDiff}
                    disableWorkerPool={diff.lineCount > 10_000}
                    options={{ diffStyle: diffView, diffIndicators: 'classic', themeType, theme: OPENTIG_CODE_THEMES, overflow: wrapLines ? 'wrap' : 'scroll', disableFileHeader: true, hunkSeparators: 'line-info-basic', unsafeCSS: VIEWER_SCROLLBAR_CSS }}
                  />
                )}
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

function CompactFileHeader({ file, actions }: { file: DiffFileEntry; actions: React.ReactNode }) {
  const [pathRef, truncated] = useTruncatedText(file.path);
  return (
    <div className="diff-file-header diff-file-header-compact">
      <Tooltip disabled={!truncated}>
        <TooltipTrigger render={<span ref={pathRef} className="diff-file-path" />}><DiffFilePathLabel path={file.path} /></TooltipTrigger>
        <TooltipContent>{file.path}</TooltipContent>
      </Tooltip>
      <FileHeaderFacts file={file} />
      {actions}
    </div>
  );
}

function CollapsibleFileHeader({ file, collapsed, onToggle }: { file: DiffFileEntry; collapsed: boolean; onToggle(): void }) {
  const [pathRef, truncated] = useTruncatedText(file.path);
  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger render={<button type="button" className="diff-file-header" aria-expanded={!collapsed} onClick={onToggle} />}>
        {collapsed ? <IconChevronRight className="diff-file-chevron" /> : <IconChevronDown className="diff-file-chevron" />}
        <span ref={pathRef} className="diff-file-path"><DiffFilePathLabel path={file.path} /></span>
        <FileHeaderFacts file={file} />
      </TooltipTrigger>
      <TooltipContent anchor={pathRef}>{file.path}</TooltipContent>
    </Tooltip>
  );
}

function DiffAction({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
