import { useState } from 'react';
import { File, UnresolvedFile, Virtualizer } from '@pierre/diffs/react';
import type { MergeConflictRegion, MergeConflictResolution } from '@pierre/diffs/react';
import type { DiffResult, DiffViewPreference, FileResult, ThemePreference } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { DiffWorkspace } from './DiffWorkspace';
import { OPENTIG_CODE_THEMES } from './diffThemes';
import { VIEWER_SCROLLBAR_CSS } from './patch-utils';
import { PierreWorkerPool } from './PierreWorkerPool';

type PierreDiffViewerProps =
  | {
      kind: 'diff';
      contentKey: string;
      value: DiffResult;
      diffView: DiffViewPreference;
      themeType: ThemePreference;
      wrapLines: boolean;
      initiallyCollapsed?: boolean;
      compact?: boolean;
      scopeControl?: React.ReactNode;
      onDiffViewChange?(value: DiffViewPreference): void;
      onWrapLinesChange?(value: boolean): void;
      onClose?(): void;
    }
  | {
      kind: 'conflict';
      contentKey: string;
      file: FileResult;
      revision: number;
      themeType: ThemePreference;
      overflow: 'scroll' | 'wrap';
      onUpdate(path: string, content: string): Promise<boolean>;
      onResolve(path: string, content: string): Promise<boolean>;
    };

export default function PierreDiffViewer(props: PierreDiffViewerProps) {
  return (
    <PierreWorkerPool>
      <div key={props.contentKey} className="viewer-transition">
        {props.kind === 'diff'
          ? <DiffContent {...props} />
          : (
            <ConflictViewer
              key={`${props.file.path}:${props.revision}`}
              file={props.file}
              themeType={props.themeType}
              overflow={props.overflow}
              onUpdate={props.onUpdate}
              onResolve={props.onResolve}
            />
          )}
      </div>
    </PierreWorkerPool>
  );
}

function DiffContent({ contentKey, value, diffView, themeType, wrapLines, initiallyCollapsed, compact, scopeControl, onDiffViewChange, onWrapLinesChange, onClose }: Extract<PierreDiffViewerProps, { kind: 'diff' }>) {
  return (
    <DiffWorkspace
      key={contentKey}
      contentKey={contentKey}
      diff={value}
      diffView={diffView}
      themeType={themeType}
      wrapLines={wrapLines}
      initiallyCollapsed={initiallyCollapsed}
      compact={compact}
      scopeControl={scopeControl}
      onDiffViewChange={onDiffViewChange}
      onWrapLinesChange={onWrapLinesChange}
      onClose={onClose}
    />
  );
}

function ConflictViewer({ file, themeType, overflow, onUpdate, onResolve }: {
  file: FileResult;
  themeType: ThemePreference;
  overflow: 'scroll' | 'wrap';
  onUpdate(path: string, content: string): Promise<boolean>;
  onResolve(path: string, content: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState(file.content);
  const [draftRevision, setDraftRevision] = useState(0);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const unresolved = countConflictBlocks(draft);

  const applyResolution = async (conflict: MergeConflictRegion, resolution: MergeConflictResolution) => {
    if (applying) return;
    setApplying(true);
    const previous = draft;
    const next = resolveConflictContent(draft, conflict, resolution);
    setDraft(next);
    setDraftRevision((value) => value + 1);
    try {
      if (!await onUpdate(file.path, next)) {
        setDraft(previous);
        setDraftRevision((value) => value + 1);
      }
    } finally {
      setApplying(false);
    }
  };

  const save = async () => {
    if (unresolved > 0 || saving) return;
    setSaving(true);
    try { await onResolve(file.path, draft); }
    finally { setSaving(false); }
  };

  return (
    <div className="conflict-viewer">
      <div className="conflict-viewer-toolbar">
        <div><strong>Conflict resolution</strong><span>{unresolved > 0 ? `${unresolved} ${unresolved === 1 ? 'pending block' : 'pending blocks'}` : 'All blocks are resolved'}</span></div>
        <Button size="sm" disabled={unresolved > 0 || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Mark as resolved'}</Button>
      </div>
      <Virtualizer className="viewer-scroll" contentClassName="viewer-content">
        {unresolved > 0 ? (
          <UnresolvedFile
            key={`${file.path}:${draftRevision}`}
            file={{ name: file.path, contents: draft, cacheKey: `${file.path}:conflict:${draftRevision}` }}
            disableWorkerPool={draft.length > 500_000}
            options={{ themeType, theme: OPENTIG_CODE_THEMES, diffIndicators: 'classic', overflow, mergeConflictActionsType: 'none', unsafeCSS: VIEWER_SCROLLBAR_CSS }}
            renderMergeConflictUtility={(action) => (
              <div className="conflict-actions">
                <Button size="xs" variant="outline" disabled={applying} onClick={() => void applyResolution(action.conflict, 'current')}>Accept current</Button>
                <Button size="xs" variant="outline" disabled={applying} onClick={() => void applyResolution(action.conflict, 'incoming')}>Accept incoming</Button>
                <Button size="xs" variant="outline" disabled={applying} onClick={() => void applyResolution(action.conflict, 'both')}>Accept both</Button>
              </div>
            )}
          />
        ) : (
          <File
            file={{ name: file.path, contents: draft, cacheKey: `${file.path}:resolved:${draftRevision}` }}
            options={{ themeType, theme: OPENTIG_CODE_THEMES, overflow, unsafeCSS: VIEWER_SCROLLBAR_CSS }}
          />
        )}
      </Virtualizer>
    </div>
  );
}

function countConflictBlocks(content: string): number {
  return content.split(/\r?\n/).filter((line) => /^<{7}(?: |$)/.test(line)).length;
}

function resolveConflictContent(content: string, conflict: MergeConflictRegion, resolution: MergeConflictResolution): string {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const current = lines.slice(conflict.startLineIndex + 1, conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex);
  const incoming = lines.slice(conflict.separatorLineIndex + 1, conflict.endLineIndex);
  const replacement = resolution === 'current' ? current : resolution === 'incoming' ? incoming : [...current, ...incoming];
  return [...lines.slice(0, conflict.startLineIndex), ...replacement, ...lines.slice(conflict.endLineIndex + 1)].join('');
}
