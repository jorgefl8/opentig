import { useEffect, useRef, type ReactNode } from 'react';
import { IconLoader4 } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';

/** Takes a viewer's place while its title and text are edited, with Save and Cancel where the actions were. */
export function ViewerEditor({ titleId, title, edited, busy, canSave, note, onTitleChange, onSave, onClose, children }: {
  titleId: string;
  title: string;
  edited: boolean;
  busy: boolean;
  canSave: boolean;
  note: string;
  onTitleChange(title: string): void;
  onSave(): void;
  onClose(): void;
  /** The text field. */
  children: ReactNode;
}) {
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => { titleInput.current?.focus(); }, []);
  return (
    // Escape only leaves an untouched editor, so a stray key can't throw text away.
    <div className="pr-viewer" onKeyDown={(event) => { if (event.key === 'Escape' && !edited && !busy) onClose(); }}>
      <header className="pr-viewer-header no-tabs">
        <div className="pr-viewer-top">
          <input ref={titleInput} id={titleId} className="field-input pr-editor-title" aria-label="Title" value={title} maxLength={300} disabled={busy} onChange={(event) => onTitleChange(event.target.value)} />
          <span className="pr-action-bar">
            <Button variant="ghost" size="xs" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button size="xs" disabled={busy || !title.trim() || !canSave} onClick={onSave}>
              {busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Saving…" /></> : 'Save changes'}
            </Button>
          </span>
        </div>
      </header>
      <div className="pr-editor-body">
        {children}
        <p className="pr-action-note">{note}</p>
      </div>
    </div>
  );
}
