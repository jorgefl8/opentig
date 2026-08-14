import { useMemo, useState } from 'react';
import { PatchDiff, Virtualizer } from '@pierre/diffs/react';
import {
  IconArrowsMaximize, IconArrowsMinimize, IconChevronDown, IconChevronRight,
  IconLayoutColumns, IconLayoutRows, IconTextWrap, IconX,
} from '@tabler/icons-react';
import type { DiffResult, DiffViewPreference, ThemePreference } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { JUSTGIT_DIFF_THEMES } from './diffThemes';
import { buildDiffFileEntries, VIEWER_SCROLLBAR_CSS } from './patch-utils';

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

export function DiffWorkspace({ contentKey, diff, diffView, themeType, wrapLines, initiallyCollapsed = false, compact = false, scopeControl, onDiffViewChange, onWrapLinesChange, onClose }: DiffWorkspaceProps) {
  const files = useMemo(() => buildDiffFileEntries(diff.patch), [diff.patch]);
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
      {!compact && <div className="diff-workspace-toolbar">
        {scopeControl && <div className="diff-workspace-scope">{scopeControl}</div>}
        <span className="diff-file-count">{files.length} {files.length === 1 ? 'file' : 'files'}</span>
        <span className="diff-total-stats" aria-label={`${additions} additions and ${deletions} deletions`}>
          <span className="add">+{additions}</span><span className="del">−{deletions}</span>
        </span>
        {diffActions(true)}
      </div>}
      <Virtualizer className="diff-workspace-scroll" contentClassName="diff-workspace-content">
        {files.map((file) => {
          const isCollapsed = !compact && collapsed.has(file.key);
          return (
            <section key={file.key} className="diff-file-section">
              {compact ? (
                <div className="diff-file-header diff-file-header-compact">
                  <img src={getVsCodeFileIconUrl(file.path)} className="diff-file-icon" alt="" />
                  <span className="diff-file-path" title={file.path}>{file.path}</span>
                  {file.previousPath && file.previousPath !== file.path && <span className="diff-file-previous">from {file.previousPath}</span>}
                  <span className="diff-file-stats"><span className="add">+{file.additions}</span><span className="del">−{file.deletions}</span></span>
                  {diffActions(false)}
                </div>
              ) : (
                <button type="button" className="diff-file-header" aria-expanded={!isCollapsed} onClick={() => toggleFile(file.key)}>
                  {isCollapsed ? <IconChevronRight className="diff-file-chevron" /> : <IconChevronDown className="diff-file-chevron" />}
                  <img src={getVsCodeFileIconUrl(file.path)} className="diff-file-icon" alt="" />
                  <span className="diff-file-path" title={file.path}>{file.path}</span>
                  {file.previousPath && file.previousPath !== file.path && <span className="diff-file-previous">from {file.previousPath}</span>}
                  <span className="diff-file-stats"><span className="add">+{file.additions}</span><span className="del">−{file.deletions}</span></span>
                </button>
              )}
              {!isCollapsed && (
                <PatchDiff
                  key={`${contentKey}:${file.key}:${diffView}:${wrapLines}`}
                  patch={file.patch}
                  disableWorkerPool={diff.lineCount > 10_000}
                  options={{ diffStyle: diffView, diffIndicators: 'classic', themeType, theme: JUSTGIT_DIFF_THEMES, overflow: wrapLines ? 'wrap' : 'scroll', disableFileHeader: true, hunkSeparators: 'line-info-basic', unsafeCSS: VIEWER_SCROLLBAR_CSS }}
                />
              )}
            </section>
          );
        })}
      </Virtualizer>
    </div>
  );
}

function DiffAction({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant={pressed ? 'secondary' : 'ghost'} size="icon-sm" aria-label={label} aria-pressed={pressed} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
