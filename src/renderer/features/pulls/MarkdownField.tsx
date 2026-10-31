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
  onChange(value: string): void;
}

/** GitHub Markdown with its preview, for text that gets published. */
export function MarkdownField({ id, label, value, rows, placeholder, emptyPreview, disabled = false, onChange }: MarkdownFieldProps) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
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
      <div className="create-pr-body-header">
        <label htmlFor={id}>{label}</label>
        <ViewerTabsList
          label={`${label} view`}
          className="markdown-viewer-tabs"
          items={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]}
        />
      </div>
      <ViewerTabsPanel value="edit" className="create-pr-body-panel">
        <Textarea id={id} value={value} rows={rows} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </ViewerTabsPanel>
      <ViewerTabsPanel value="preview" className="create-pr-preview"><LinkedMarkdown html={previewHtml} /></ViewerTabsPanel>
    </ViewerTabs>
  );
}
