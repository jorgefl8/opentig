import { useQuery } from '@tanstack/react-query';
import type { PublicationContext } from '@shared/repository-access';
import { opentig } from '@/lib/opentig-api';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RemoteChoice } from './useBranchPush';

export function PublishRemoteDialog({ choice, onSelect }: { choice: RemoteChoice; onSelect(context: PublicationContext | null): void }) {
  const [remote, setRemote] = useState(choice.result.remotes[0] ?? '');
  const context = useQuery({ queryKey: ['publication-review', choice.id, remote], queryFn: () => opentig.refs.pushContext(choice.repositoryId, remote), enabled: !!remote });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSelect(null); }}>
      <DialogPopup className="undo-commit-dialog">
        <div className="undo-commit-content">
          <DialogTitle>Publish branch</DialogTitle>
          <DialogDescription>Choose the remote for <strong>{choice.result.branch}</strong> in {choice.label}. Review the account and destination before publishing. A new branch also gets an upstream.</DialogDescription>
          <Select value={remote} onValueChange={(value) => setRemote(value ?? '')}>
            <SelectTrigger aria-label="Publish to remote"><SelectValue /></SelectTrigger>
            <SelectContent>{choice.result.remotes.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
          {context.data && <div className="repository-access-status"><p><strong>{context.data.login ? `@${context.data.login}` : 'External Git authentication'}</strong></p><p>{context.data.urls.join(', ')}</p><p>{context.data.targetRef}</p>{context.data.blocked && <p role="alert">{context.data.blocked}</p>}</div>}
          {context.error && <p role="alert">Could not resolve the destination. Close and try again.</p>}
        </div>
        <div className="undo-commit-actions">
          <Button variant="ghost" onClick={() => onSelect(null)}>Cancel</Button>
          <Button disabled={!context.data || !!context.data.blocked || context.isFetching} onClick={() => onSelect(context.data ?? null)}>Publish branch</Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
