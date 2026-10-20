import { useEffect, useState } from 'react';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { FileSaveControls, SourceCodeEditor } from './EditableFileViewer';
import { FileViewerToolbar } from './FileViewerToolbar';
import { useEditableFileDraft } from './useEditableFileDraft';
import './html-file-viewer.css';
import { HtmlPreviewFrame } from './HtmlPreviewFrame';
import type { HtmlPreviewAnchor } from './html-preview-links';

interface HtmlFileViewerProps {
  repositoryId: string;
  anchor: HtmlPreviewAnchor | null;
  onNavigate(path: string, hash: string): void;
  file: FileResult;
  /** The draft App is holding for this path, or the file's own content. */
  initialContent: string;
  themeType: ThemePreference;
  wrapLines: boolean;
  readOnly: boolean;
  onDirtyChange(dirty: boolean): void;
  onDraftChange(content: string): void;
  onSave(path: string, content: string, expectedContent: string): Promise<WriteFileResult>;
}

const HTML_SAVE_MESSAGES = {
  conflictTitle: 'HTML was changed outside OpenTig',
  successTitle: 'HTML saved',
  errorTitle: 'Could not save HTML',
};

export function HtmlFileViewer({ repositoryId, anchor, onNavigate, file, initialContent, themeType, wrapLines, readOnly, onDirtyChange, onDraftChange, onSave }: HtmlFileViewerProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const { draft, updateDraft, dirty, saving, save } = useEditableFileDraft({
    file, initialContent, readOnly, messages: HTML_SAVE_MESSAGES, onDirtyChange, onDraftChange, onSave,
  });
  useEffect(() => {
    setTab('preview');
  }, [file.path]);

  return (
    <ViewerTabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="markdown-viewer html-file-viewer">
      <FileViewerToolbar
        start={
          <ViewerTabsList
            label="HTML view"
            className="file-viewer-tabs"
            items={[
              { value: 'preview', label: 'Preview' },
              { value: 'code', label: <>Code {dirty && <span className="file-viewer-unsaved-dot" aria-label="Unsaved changes" />}</> },
            ]}
          />
        }
        end={<FileSaveControls dirty={dirty} saving={saving} readOnly={readOnly} onSave={() => void save()} />}
      />
      <ViewerTabsPanel value="preview" className="html-preview-panel">
        <HtmlPreviewFrame document={draft} repositoryId={repositoryId} path={file.path} active={tab === 'preview'} anchor={anchor} onNavigate={onNavigate} />
      </ViewerTabsPanel>
      <ViewerTabsPanel value="code" className="markdown-code-view" data-theme={themeType}>
          <SourceCodeEditor
            path={file.path}
            cacheKey={file.path}
            value={draft}
            themeType={themeType}
            wrapLines={wrapLines}
            readOnly={readOnly}
            onChange={updateDraft}
          />
      </ViewerTabsPanel>
    </ViewerTabs>
  );
}
