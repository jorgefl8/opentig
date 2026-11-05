import { useState } from 'react';
import { IconAlertTriangle, IconArrowLeft, IconFolderSearch, IconLoader4, IconTrash } from '@tabler/icons-react';
import type { RecentRepository } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';

/**
 * Shown instead of the workspace when the active repository's folder is gone,
 * so background refreshes stop and the way back is one click away.
 */
export function RepositoryUnavailable({ repository, otherMissing, onLocate, onRemove, onOpenAnother }: {
  repository: RecentRepository;
  /** Other saved repositories that are also missing. */
  otherMissing: number;
  onLocate(): Promise<void>;
  onRemove(): Promise<void>;
  onOpenAnother(): void;
}) {
  const [busy, setBusy] = useState<'locate' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: 'locate' | 'remove', task: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    setError(null);
    try { await task(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Something went wrong.'); }
    finally { setBusy(null); }
  };
  return (
    <div className="welcome repository-unavailable">
      {window.opentigDesktop && <div className="welcome-titlebar" aria-hidden="true" />}
      <span className="repository-unavailable-icon" aria-hidden="true"><IconAlertTriangle /></span>
      <h1>{repository.name} was not found</h1>
      <p>Its folder was moved, renamed, or deleted. OpenTig stopped refreshing it until you choose where it is now.</p>
      <code className="repository-unavailable-path">{repository.path}</code>
      {otherMissing > 0 && <p className="repository-unavailable-note">{otherMissing} other saved {otherMissing === 1 ? 'repository is' : 'repositories are'} missing too. After you locate this one, OpenTig looks for them nearby.</p>}
      <div className="repository-unavailable-actions">
        <Button disabled={Boolean(busy)} onClick={() => void run('locate', onLocate)}>
          {busy === 'locate' ? <IconLoader4 className="animate-spin" /> : <IconFolderSearch />}Locate folder…
        </Button>
        <Button variant="outline" disabled={Boolean(busy)} onClick={() => void run('remove', onRemove)}>
          {busy === 'remove' ? <IconLoader4 className="animate-spin" /> : <IconTrash />}Remove from OpenTig
        </Button>
        <Button variant="ghost" disabled={Boolean(busy)} onClick={onOpenAnother}><IconArrowLeft />Open another repository</Button>
      </div>
      {error && <p className="repository-unavailable-error" role="alert">{error}</p>}
    </div>
  );
}
