import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
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

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setTab((current) => current === 'preview' ? 'code' : 'preview');
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const nextIndex = event.currentTarget === tabs?.[0] ? 1 : 0;
    tabs?.[nextIndex]?.focus();
  };

  return (
    <div className="markdown-viewer html-file-viewer">
      <div className="file-viewer-pill markdown-viewer-toolbar">
        <div role="tablist" aria-label="HTML view" className="file-viewer-tabs markdown-viewer-tabs">
          <button type="button" role="tab" aria-selected={tab === 'preview'} onKeyDown={handleTabKeyDown} onClick={() => setTab('preview')}>Preview</button>
          <button type="button" role="tab" aria-selected={tab === 'code'} onKeyDown={handleTabKeyDown} onClick={() => setTab('code')}>
            Code {dirty && <span className="markdown-unsaved-dot" aria-label="Unsaved changes" />}
          </button>
        </div>
        <FileSaveControls dirty={dirty} saving={saving} readOnly={readOnly} onSave={() => void save()} />
      </div>
      {tab === 'preview' ? (
        <iframe
          className="html-preview-frame"
          title={`Preview of ${file.path}`}
          srcDoc={previewDocument}
          sandbox=""
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="markdown-code-view" data-theme={themeType}>
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
        </div>
      )}
    </div>
  );
}
