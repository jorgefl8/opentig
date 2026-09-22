import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';

/** Browser paths belong to the server, not the phone's local filesystem. */
export function OpenRepositoryDialog({ open, onOpenChange, onOpen }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpen(path: string): Promise<void>;
}) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setError(null); onOpenChange(next); } }}>
      <DialogPopup className="name-dialog">
        <form className="name-dialog-content" onSubmit={(event) => {
          event.preventDefault();
          if (!path.trim() || busy) return;
          setBusy(true);
          setError(null);
          void onOpen(path.trim()).then(() => { onOpenChange(false); setPath(''); }).catch((reason) => {
            setError(reason instanceof Error ? reason.message : 'Could not open this repository.');
          }).finally(() => setBusy(false));
        }}>
          <DialogTitle>Open repository</DialogTitle>
          <DialogDescription>Enter a repository path on the OpenTig server.</DialogDescription>
          <label htmlFor="repository-path">Server path</label>
          <input id="repository-path" className="name-dialog-input" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/path/to/repository" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={busy} />
          {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
          <div className="name-dialog-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !path.trim()}>{busy ? 'Opening…' : 'Open repository'}</Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
