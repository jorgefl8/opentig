import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconCheck, IconViewportNarrow, IconViewportWide } from '@tabler/icons-react';
import { toast } from 'sonner';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FileSaveControls, SourceCodeEditor } from '@/features/viewer/EditableFileViewer';
import { renderMarkdown } from './render-markdown';
import { useMermaid } from './useMermaid';
import './markdown.css';

interface MarkdownFileViewerProps {
  file: FileResult;
  revision: number;
  themeType: ThemePreference;
  wrapLines: boolean;
  readOnly: boolean;
  onDirtyChange(dirty: boolean): void;
  onSave(path: string, content: string, expectedContent: string): Promise<WriteFileResult>;
}

type ContentWidth = 'reading' | 'fit';

const CONTENT_WIDTH_STORAGE_KEY = 'justgit:markdown-content-width';

function getInitialContentWidth(): ContentWidth {
  try {
    return window.localStorage.getItem(CONTENT_WIDTH_STORAGE_KEY) === 'fit' ? 'fit' : 'reading';
  } catch {
    return 'reading';
  }
}

interface MarkdownPreviewContentProps {
  html: string;
  onClick(event: React.MouseEvent<HTMLDivElement>): void;
}

function MarkdownPreviewContent({ html, onClick }: MarkdownPreviewContentProps) {
  const previewRef = useRef<HTMLDivElement>(null);

  // Mermaid owns the descendants after it replaces its source with an SVG.
  // Only write the sanitized Markdown when that source HTML actually changes;
  // otherwise a React re-render would restore the raw `graph TD` text.
  useLayoutEffect(() => {
    if (previewRef.current) previewRef.current.innerHTML = html;
  }, [html]);
  useMermaid(previewRef, true, html);

  return <div ref={previewRef} className="markdown-prose" onClick={onClick} />;
}

export function MarkdownFileViewer({ file, revision, themeType, wrapLines, readOnly, onDirtyChange, onSave }: MarkdownFileViewerProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [contentWidth, setContentWidth] = useState<ContentWidth>(getInitialContentWidth);
  const [draft, setDraft] = useState(file.content);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const requestToken = useRef(0);
  const dirty = draft !== file.content;

  useEffect(() => {
    setTab('preview');
  }, [file.path]);

  useEffect(() => {
    const token = ++requestToken.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const startedAt = window.__justgitPerformanceAutomation ? performance.now() : null;
      renderMarkdown(draft).then((result) => {
        if (token === requestToken.current) {
          setHtml(result);
          if (startedAt !== null) {
            window.__justgitPerformanceResults ??= [];
            window.__justgitPerformanceResults.push({
              kind: 'markdown-render',
              durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            });
          }
        }
      }).catch(() => {
        if (token === requestToken.current) setHtml('<p>Could not render Markdown.</p>');
      }).finally(() => {
        if (token === requestToken.current) setLoading(false);
      });
    }, dirty ? 120 : 0);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, file.mtimeMs, file.path, revision, themeType]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [dirty]);

  const handlePreviewClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>('[data-copy-code]');
    if (copy) {
      const encoded = copy.dataset.copyCode;
      if (!encoded) return;
      try {
        const code = decodeURIComponent(encoded);
        await window.justgit.clipboard.writeText(code);
        setCopied(encoded);
        window.setTimeout(() => setCopied((current) => current === encoded ? null : current), 1_500);
      } catch {
        toast.error('Could not copy code');
      }
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const href = link?.getAttribute('href');
    if (!link || !href) return;
    event.preventDefault();
    if (!href.startsWith('#')) return;
    const element = event.currentTarget.querySelector<HTMLElement>(`#${CSS.escape(href.slice(1))}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setTab((current) => current === 'preview' ? 'code' : 'preview');
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const nextIndex = event.currentTarget === tabs?.[0] ? 1 : 0;
    tabs?.[nextIndex]?.focus();
  };

  const save = useCallback(async () => {
    if (!dirty || saving || readOnly) return;
    setSaving(true);
    try {
      const result = await onSave(file.path, draft, file.content);
      if (result.status === 'conflict') {
        toast.error('Markdown was changed outside JustGit', {
          description: 'Your draft is still open. Copy it or reload the file before saving again.',
          duration: 10_000,
        });
        return;
      }
      toast.success('Markdown saved', { description: file.path });
    } catch (reason) {
      toast.error('Could not save Markdown', {
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

  const changeContentWidth = (value: ContentWidth) => {
    setContentWidth(value);
    try {
      window.localStorage.setItem(CONTENT_WIDTH_STORAGE_KEY, value);
    } catch {
      // The in-memory preference still works if storage is unavailable.
    }
  };

  return (
    <div className="markdown-viewer" data-content-width={contentWidth}>
      <div className="file-viewer-pill markdown-viewer-toolbar">
        <div role="tablist" aria-label="Markdown view" className="file-viewer-tabs markdown-viewer-tabs">
          <button type="button" role="tab" aria-selected={tab === 'preview'} onKeyDown={handleTabKeyDown} onClick={() => setTab('preview')}>Preview</button>
          <button type="button" role="tab" aria-selected={tab === 'code'} onKeyDown={handleTabKeyDown} onClick={() => setTab('code')}>
            Code {dirty && <span className="markdown-unsaved-dot" aria-label="Unsaved changes" />}
          </button>
        </div>
        <FileSaveControls dirty={dirty} saving={saving} readOnly={readOnly} onSave={() => void save()} />
        <div className="markdown-width-toggle" role="group" aria-label="Markdown content width">
          <Tooltip>
            <TooltipTrigger render={
              <button
                type="button"
                aria-label="Reading width"
                aria-pressed={contentWidth === 'reading'}
                onClick={() => changeContentWidth('reading')}
              />
            }>
              <IconViewportNarrow aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Reading width</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={
              <button
                type="button"
                aria-label="Fit to width"
                aria-pressed={contentWidth === 'fit'}
                onClick={() => changeContentWidth('fit')}
              />
            }>
              <IconViewportWide aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Fit to width</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {tab === 'preview' ? (
        <div className="markdown-preview-scroll">
          {loading ? (
            <div className="viewer-message"><ShimmeringText text="Rendering Markdown…" /></div>
          ) : (
            <MarkdownPreviewContent html={html} onClick={(event) => void handlePreviewClick(event)} />
          )}
          {copied && <span className="markdown-copy-status" role="status"><IconCheck /> Copied</span>}
        </div>
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
            }}
          />
        </div>
      )}
    </div>
  );
}
