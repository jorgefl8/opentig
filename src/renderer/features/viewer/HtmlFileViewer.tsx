import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { FileSaveControls, SourceCodeEditor } from './EditableFileViewer';
import { buildHtmlPreviewDocument } from './html-preview-document';
import { useEditableFileDraft } from './useEditableFileDraft';
import './html-file-viewer.css';

interface HtmlFileViewerProps {
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

export function HtmlFileViewer({ file, initialContent, themeType, wrapLines, readOnly, onDirtyChange, onDraftChange, onSave }: HtmlFileViewerProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const formRef = useRef<HTMLFormElement>(null);
  const frameName = `html-preview-${useId().replace(/:/g, '')}`;
  const { draft, updateDraft, dirty, saving, save } = useEditableFileDraft({
    file, initialContent, readOnly, messages: HTML_SAVE_MESSAGES, onDirtyChange, onDraftChange, onSave,
  });
  const darkPreviewChrome = themeType === 'dark'
    || (themeType === 'system' && document.documentElement.classList.contains('dark'));
  const previewDocument = useMemo(
    () => buildHtmlPreviewDocument(draft, darkPreviewChrome),
    [darkPreviewChrome, draft],
  );
  // srcdoc inherits the app Content-Security-Policy, which blocks inline scripts.
  // Posting the draft lets the response carry its own sandboxed policy.
  useEffect(() => {
    if (tab !== 'preview') return;
    formRef.current?.requestSubmit();
  }, [previewDocument, tab]);

  useEffect(() => {
    setTab('preview');
  }, [file.path]);

  return (
    <ViewerTabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="markdown-viewer html-file-viewer">
      <div className="file-viewer-pill markdown-viewer-toolbar">
        <ViewerTabsList
          label="HTML view"
          className="file-viewer-tabs markdown-viewer-tabs"
          items={[
            { value: 'preview', label: 'Preview' },
            { value: 'code', label: <>Code {dirty && <span className="markdown-unsaved-dot" aria-label="Unsaved changes" />}</> },
          ]}
        />
        <FileSaveControls dirty={dirty} saving={saving} readOnly={readOnly} onSave={() => void save()} />
      </div>
      <ViewerTabsPanel value="preview" className="html-preview-panel">
        <iframe
          className="html-preview-frame"
          name={frameName}
          title={`Preview of ${file.path}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
        <form
          ref={formRef}
          className="html-preview-form"
          method="post"
          action="/api/html-preview"
          target={frameName}
          encType="application/x-www-form-urlencoded"
        >
          <input type="hidden" name="document" value={previewDocument} />
        </form>
      </ViewerTabsPanel>
      <ViewerTabsPanel value="code" className="markdown-code-view" data-theme={themeType}>
          <SourceCodeEditor
            path={file.path}
            cacheKey={file.path}
            value={draft}
            themeType={themeType}
            wrapLines={wrapLines}
            readOnly={readOnly || saving}
            onChange={updateDraft}
          />
      </ViewerTabsPanel>
    </ViewerTabs>
  );
}
