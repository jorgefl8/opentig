import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { FileSaveControls, SourceCodeEditor } from './EditableFileViewer';
import { buildHtmlPreviewDocument } from './html-preview-document';
import '@/features/markdown/markdown.css';
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

export function HtmlFileViewer({ file, initialContent, themeType, wrapLines, readOnly, onDirtyChange, onDraftChange, onSave }: HtmlFileViewerProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [draft, setDraft] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== file.content;
  const darkPreviewChrome = themeType === 'dark'
    || (themeType === 'system' && document.documentElement.classList.contains('dark'));
  const previewDocument = useMemo(
    () => buildHtmlPreviewDocument(draft, darkPreviewChrome),
    [darkPreviewChrome, draft],
  );

  useEffect(() => {
    setTab('preview');
  }, [file.path]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const save = useCallback(async () => {
    if (!dirty || saving || readOnly) return;
    setSaving(true);
    try {
      const result = await onSave(file.path, draft, file.content);
      if (result.status === 'conflict') {
        toast.error('HTML was changed outside JustGit', {
          description: 'Your draft is still open. Copy it or reload the file before saving again.',
          duration: 10_000,
        });
        return;
      }
      toast.success('HTML saved', { description: file.path });
    } catch (reason) {
      toast.error('Could not save HTML', {
        description: reason instanceof Error ? reason.message : 'Unknown error',
        duration: 10_000,
      });
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, file.content, file.path, onSave, readOnly, saving]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void save();
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [save]);

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
      <ViewerTabsPanel
        value="preview"
        render={<iframe
          className="html-preview-frame"
          title={`Preview of ${file.path}`}
          srcDoc={previewDocument}
          sandbox=""
          referrerPolicy="no-referrer"
        />}
      />
      <ViewerTabsPanel value="code" className="markdown-code-view" data-theme={themeType}>
          <SourceCodeEditor
            path={file.path}
            cacheKey={`${file.path}:${file.mtimeMs}`}
            value={draft}
            themeType={themeType}
            wrapLines={wrapLines}
            readOnly={readOnly || saving}
            onChange={(value) => {
              setDraft(value);
              onDirtyChange(value !== file.content);
              onDraftChange(value);
            }}
          />
      </ViewerTabsPanel>
    </ViewerTabs>
  );
}
