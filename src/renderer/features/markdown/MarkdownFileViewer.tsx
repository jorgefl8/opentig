import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconViewportNarrow, IconViewportWide } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { FileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { FileSaveControls, SourceCodeEditor, type SourceCodeEditorHandle } from '@/features/viewer/EditableFileViewer';
import { useEditableFileDraft } from '@/features/viewer/useEditableFileDraft';
import { resolveMarkdownRepositoryPath } from './markdown-links';
import { renderMarkdown } from './render-markdown';
import { useMermaid } from './useMermaid';
import './markdown.css';

interface MarkdownFileViewerProps {
  file: FileResult;
  /** The draft App is holding for this path, or the file's own content. */
  initialContent: string;
  revision: number;
  themeType: ThemePreference;
  wrapLines: boolean;
  readOnly: boolean;
  onOpenFile(path: string): void;
  onDirtyChange(dirty: boolean): void;
  onDraftChange(content: string): void;
  onSave(path: string, content: string, expectedContent: string): Promise<WriteFileResult>;
}

type ContentWidth = 'reading' | 'fit';

const CONTENT_WIDTH_STORAGE_KEY = 'justgit:markdown-content-width';

const MARKDOWN_SAVE_MESSAGES = {
  conflictTitle: 'Markdown was changed outside JustGit',
  successTitle: 'Markdown saved',
  errorTitle: 'Could not save Markdown',
};

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

export function MarkdownFileViewer({ file, initialContent, revision, themeType, wrapLines, readOnly, onOpenFile, onDirtyChange, onDraftChange, onSave }: MarkdownFileViewerProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [contentWidth, setContentWidth] = useState<ContentWidth>(getInitialContentWidth);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const requestToken = useRef(0);
  const copyFeedback = useRef<{ button: HTMLButtonElement; timer: number } | null>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<SourceCodeEditorHandle>(null);
  const pendingScrollFraction = useRef<number | null>(null);
  const { draft, updateDraft, dirty, saving, save } = useEditableFileDraft({
    file, initialContent, readOnly, messages: MARKDOWN_SAVE_MESSAGES, onDirtyChange, onDraftChange, onSave,
  });

  useEffect(() => {
    setTab('preview');
  }, [file.path]);

  // Capture the scroll position of the tab being left as a 0-1 fraction so the
  // panel being entered can restore roughly the same reading position instead
  // of defaulting to whatever position it happens to mount at.
  const handleTabChange = useCallback((nextTab: 'preview' | 'code') => {
    setTab((currentTab) => {
      if (nextTab === currentTab) return currentTab;
      if (currentTab === 'preview') {
        const el = previewPanelRef.current;
        const max = el ? el.scrollHeight - el.clientHeight : 0;
        pendingScrollFraction.current = el && max > 0 ? el.scrollTop / max : 0;
      } else {
        pendingScrollFraction.current = sourceEditorRef.current?.getScrollFraction() ?? 0;
      }
      return nextTab;
    });
  }, []);

  useLayoutEffect(() => {
    const fraction = pendingScrollFraction.current;
    if (fraction == null) return;
    pendingScrollFraction.current = null;
    if (tab === 'preview') {
      const el = previewPanelRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = max > 0 ? fraction * max : 0;
    } else {
      sourceEditorRef.current?.scrollToFraction(fraction);
    }
  }, [tab]);

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

  useEffect(() => () => {
    if (copyFeedback.current) window.clearTimeout(copyFeedback.current.timer);
  }, []);

  const handlePreviewClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>('[data-copy-code]');
    if (copy) {
      const encoded = copy.dataset.copyCode;
      if (!encoded) return;
      try {
        const code = decodeURIComponent(encoded);
        await window.justgit.clipboard.writeText(code);
        const previous = copyFeedback.current;
        if (previous) {
          window.clearTimeout(previous.timer);
          delete previous.button.dataset.copyState;
          previous.button.setAttribute('aria-label', 'Copy code');
        }
        copy.dataset.copyState = 'copied';
        copy.setAttribute('aria-label', 'Copied');
        setCopied(true);
        const timer = window.setTimeout(() => {
          if (copyFeedback.current?.button !== copy) return;
          delete copy.dataset.copyState;
          copy.setAttribute('aria-label', 'Copy code');
          copyFeedback.current = null;
          setCopied(false);
        }, 2_000);
        copyFeedback.current = { button: copy, timer };
      } catch {
        sileo.error({ title: 'Could not copy code' });
      }
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const href = link?.getAttribute('href');
    if (!link || !href) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      const element = event.currentTarget.querySelector<HTMLElement>(`#${CSS.escape(href.slice(1))}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const repositoryPath = resolveMarkdownRepositoryPath(file.path, href);
    if (repositoryPath) onOpenFile(repositoryPath);
  }, [file.path, onOpenFile]);

  const changeContentWidth = (value: ContentWidth) => {
    setContentWidth(value);
    try {
      window.localStorage.setItem(CONTENT_WIDTH_STORAGE_KEY, value);
    } catch {
      // The in-memory preference still works if storage is unavailable.
    }
  };

  return (
    <ViewerTabs value={tab} onValueChange={(value) => handleTabChange(value as typeof tab)} className="markdown-viewer" data-content-width={contentWidth}>
      <div className="file-viewer-pill markdown-viewer-toolbar">
        <ViewerTabsList
          label="Markdown view"
          className="file-viewer-tabs markdown-viewer-tabs"
          items={[
            { value: 'preview', label: 'Preview' },
            { value: 'code', label: <>Code {dirty && <span className="markdown-unsaved-dot" aria-label="Unsaved changes" />}</> },
          ]}
        />
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
      <ViewerTabsPanel ref={previewPanelRef} value="preview" className="markdown-preview-scroll">
          {loading && !html ? (
            <div className="viewer-message"><ShimmeringText text="Rendering Markdown…" /></div>
          ) : (
            <MarkdownPreviewContent html={html} onClick={(event) => void handlePreviewClick(event)} />
          )}
          <span className="sr-only" role="status" aria-live="polite">{copied ? 'Code copied' : ''}</span>
      </ViewerTabsPanel>
      <ViewerTabsPanel value="code" className="markdown-code-view" data-theme={themeType}>
          <SourceCodeEditor
            ref={sourceEditorRef}
            path={file.path}
            cacheKey={`${file.path}:${file.mtimeMs}`}
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
