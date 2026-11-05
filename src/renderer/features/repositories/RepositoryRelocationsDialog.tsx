import { useState } from 'react';
import { IconLoader4 } from '@tabler/icons-react';
import type { RepositoryRelocationSearch } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';

/** Offers to update every other moved repository found next to the one just relocated. */
export function RepositoryRelocationsDialog({ search, onConfirm, onClose }: {
  search: RepositoryRelocationSearch;
  /** Rejects with a message when some repositories could not be relocated. */
  onConfirm(entries: { id: string; path: string }[]): Promise<void>;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(search.candidates.map((item) => item.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = search.candidates.length;
  const confirm = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(search.candidates.filter((item) => selected.has(item.id)).map(({ id, path }) => ({ id, path })));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not relocate the repositories.');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogPopup className="undo-commit-dialog repository-relocations-dialog">
        <div className="undo-commit-content">
          <DialogTitle>Found {count} more moved {count === 1 ? 'repository' : 'repositories'}</DialogTitle>
          <DialogDescription>
            {count === 1 ? 'It is' : 'They are'} missing from {count === 1 ? 'its' : 'their'} saved {count === 1 ? 'folder' : 'folders'}. OpenTig found {count === 1 ? 'a Git repository' : 'Git repositories'} with the same {count === 1 ? 'name' : 'names'} in <code>{search.searchedPath}</code>.
          </DialogDescription>
          <ul className="repository-relocations-list">
            {search.candidates.map((item) => (
              <li key={item.id}>
                <label>
                  <Checkbox checked={selected.has(item.id)} disabled={busy} onCheckedChange={(checked) => toggle(item.id, checked === true)} />
                  <span>
                    <strong>{item.name}</strong>
                    <small><span className="repository-relocations-old">{item.previousPath}</span> → {item.path}</small>
                  </span>
                </label>
              </li>
            ))}
            {search.unresolved.map((item) => (
              <li key={item.id} className="repository-relocations-unresolved">
                <span>
                  <strong>{item.name}</strong>
                  <small>Not found there. Locate it from the repository picker or remove it in Manage projects.</small>
                </span>
              </li>
            ))}
          </ul>
          {error && <p className="repository-relocations-error" role="alert">{error}</p>}
        </div>
        <div className="undo-commit-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Not now</Button>
          <Button disabled={busy || selected.size === 0} onClick={() => void confirm()}>
            {busy && <IconLoader4 className="animate-spin" />}Relocate {selected.size}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
