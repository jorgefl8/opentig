import { useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { LinkedMarkdown } from '@/features/markdown/LinkedMarkdown';
import '@/features/markdown/markdown.css';

interface MarkdownFieldProps {
  id: string;
  label: string;
  value: string;
  rows: number;
  placeholder: string;
  emptyPreview: string;
  disabled?: boolean;
  /** Only the text box, on one line. The box stays mounted, so its focus and text carry over. */
  collapsed?: boolean;
  onChange(value: string): void;
}

/** GitHub Markdown with its preview, for text that gets published. */
export function MarkdownField({ id, label, value, rows, placeholder, emptyPreview, disabled = false, collapsed = false, onChange }: MarkdownFieldProps) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  if (collapsed && tab !== 'edit') setTab('edit');
  const [previewHtml, setPreviewHtml] = useState('');
  const previewToken = useRef(0);
  useEffect(() => {
    if (tab !== 'preview') return;
    const token = ++previewToken.current;
    void import('@/features/markdown/render-markdown')
      .then(({ renderMarkdown }) => renderMarkdown(value || emptyPreview))
      .then((html) => {
        if (token === previewToken.current) setPreviewHtml(html);
      })
      .catch(() => {
        if (token === previewToken.current) setPreviewHtml('<p>Could not render the preview.</p>');
      });
  }, [emptyPreview, tab, value]);
  return (
    <ViewerTabs value={tab} onValueChange={(next) => setTab(next as typeof tab)} className="create-pr-field create-pr-body-field">
      {!collapsed && <div className="create-pr-body-header">
        <label htmlFor={id}>{label}</label>
        <ViewerTabsList
          label={`${label} view`}
          items={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
        />
      </div>}
      <ViewerTabsPanel value="edit" className="create-pr-body-panel">
        <Textarea id={id} className={collapsed ? 'h-8 min-h-0 overflow-hidden py-1.5' : undefined} aria-label={collapsed ? label : undefined} value={value} rows={collapsed ? 1 : rows} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </ViewerTabsPanel>
      <ViewerTabsPanel value="preview" className="create-pr-preview"><LinkedMarkdown html={previewHtml} /></ViewerTabsPanel>
    </ViewerTabs>
  );
}
