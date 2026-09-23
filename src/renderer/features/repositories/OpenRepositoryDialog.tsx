import { useCallback, useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconChevronRight, IconFolder, IconHome } from '@tabler/icons-react';
import type { ServerDirectoryListing } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';

/** Browser paths belong to the server, not the phone's local filesystem. */
export function OpenRepositoryDialog({ open, onOpenChange, onOpen, onBrowse }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpen(path: string): Promise<void>;
  onBrowse(path?: string): Promise<ServerDirectoryListing>;
}) {
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<ServerDirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const browse = useCallback(async (nextPath?: string) => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await onBrowse(nextPath);
      if (current !== request.current) return;
      setListing(result);
      setPath(result.path);
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : 'Could not browse this folder.');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [onBrowse]);

  useEffect(() => {
    if (open) {
      setListing(null);
      setPath('');
      void browse();
    }
    return () => { request.current += 1; };
  }, [open, browse]);

  const openSelected = async () => {
    if (!listing || path.trim() !== listing.path || loading || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(listing.path);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this repository.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogPopup className="repository-browser" initialFocus={false}>
        <div className="repository-browser-content">
          <div>
            <DialogTitle>Open repository</DialogTitle>
            <DialogDescription>Choose a folder on the OpenTig server.</DialogDescription>
          </div>
          <form className="repository-browser-location" onSubmit={(event) => {
            event.preventDefault();
            if (path.trim() && !busy && !loading) void browse(path.trim());
          }}>
            <label htmlFor="repository-path">Server folder</label>
            <div className="repository-browser-path">
              <input id="repository-path" className="name-dialog-input" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/path/to/repository" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} />
              <Button type="submit" variant="outline" disabled={busy || loading || !path.trim()}>Go</Button>
            </div>
          </form>
          <div className="repository-browser-navigation">
            <Button variant="outline" disabled={busy || loading} onClick={() => void browse()}><IconHome /> Home</Button>
            <Button variant="outline" disabled={busy || loading || !listing?.parentPath} onClick={() => { if (listing?.parentPath) void browse(listing.parentPath); }}><IconArrowUp /> Up</Button>
          </div>
          <div className="repository-browser-folders" aria-label="Server folders" aria-busy={loading}>
            {loading ? <p role="status">Loading folders…</p> : listing?.directories.length === 0 ? <p>No subfolders in this folder.</p> : listing?.directories.map((directory) => (
              <button type="button" key={directory.path} disabled={busy} onClick={() => void browse(directory.path)}>
                <IconFolder aria-hidden="true" /><span>{directory.name}</span><IconChevronRight aria-hidden="true" />
              </button>
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
          <div className="name-dialog-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" disabled={busy || loading || !listing || path.trim() !== listing.path} onClick={() => void openSelected()}>{busy ? 'Opening…' : 'Open this folder'}</Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
