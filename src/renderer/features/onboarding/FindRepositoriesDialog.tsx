import { useEffect, useRef, useState } from 'react';
import { IconBook2, IconGitBranch, IconLoader4 } from '@tabler/icons-react';
import type { ServerDirectoryListing } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { findRepositories, type FoundRepository } from './find-repositories';
import './onboarding.css';

export function FindRepositoriesDialog({ open, onOpenChange, known, onBrowse, onAdd, onOpenFolder }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Paths already added to OpenTig; they are not offered again. */
  known: string[];
  onBrowse(path?: string): Promise<ServerDirectoryListing>;
  onAdd(path: string): Promise<void>;
  onOpenFolder(): void;
}) {
  const [found, setFound] = useState<FoundRepository[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Scan once per opening; later changes to the known list do not restart it.
  const knownRef = useRef(known);
  useEffect(() => { knownRef.current = known; });

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setFound(null); setError('');
    void findRepositories(onBrowse, knownRef.current, controller.signal).then(setFound, () => { if (!controller.signal.aborted) setFound([]); });
    return () => controller.abort();
  }, [onBrowse, open]);

  const add = async (repository: FoundRepository) => {
    setAdding(repository.path); setError('');
    try { await onAdd(repository.path); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open this repository.'); }
    finally { setAdding(null); }
  };

  return <Dialog open={open} onOpenChange={value => { if (!adding) onOpenChange(value); }}>
    <DialogPopup className="onboarding-find-dialog">
      <DialogTitle>Repositories {window.opentigDesktop ? 'on this computer' : 'on your server'}</DialogTitle>
      <DialogDescription>Found in your home folder and common code folders such as ~/code and ~/projects. Choose one to open it.</DialogDescription>
      {!found ? <p className="onboarding-find-state" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /><ShimmeringText text="Looking for repositories…" /></p>
        : found.length === 0 ? <div className="onboarding-find-state"><strong>No new repositories found</strong><p>Browse to a folder yourself, or clone one from a URL.</p></div>
        : <ul className="onboarding-find-list" aria-label="Repositories found">{found.map(item => <li key={item.path}>
          <button type="button" disabled={Boolean(adding)} onClick={() => void add(item)}>
            <IconBook2 aria-hidden="true" /><span><strong>{item.name}</strong><small>{item.path}</small></span>
            {adding === item.path ? <IconLoader4 className="animate-spin" aria-label="Opening" /> : item.branch && <em><IconGitBranch aria-hidden="true" />{item.branch}</em>}
          </button>
        </li>)}</ul>}
      {error && <p className="onboarding-error" role="alert">{error}</p>}
      <div className="onboarding-dialog-actions">
        <Button variant="ghost" disabled={Boolean(adding)} onClick={() => onOpenChange(false)}>Close</Button>
        <Button variant="outline" disabled={Boolean(adding)} onClick={() => { onOpenChange(false); onOpenFolder(); }}>Browse folders…</Button>
      </div>
    </DialogPopup>
  </Dialog>;
}
