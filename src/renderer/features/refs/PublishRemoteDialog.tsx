import { useQuery } from '@tanstack/react-query';
import type { PublicationContext } from '@shared/repository-access';
import { opentig } from '@/lib/opentig-api';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RemoteChoice } from './useBranchPush';
import { gitCredentialsLocation, gitHttpsModeLabel } from '@/features/settings/github-access-copy';

export function PublishRemoteDialog({ choice, onSelect }: { choice: RemoteChoice; onSelect(context: PublicationContext | null): void }) {
  const [remote, setRemote] = useState(choice.result.remotes[0] ?? '');
  const context = useQuery({ queryKey: ['publication-review', choice.id, remote], queryFn: () => opentig.refs.pushContext(choice.repositoryId, remote), enabled: !!remote });
  const publishing = !(context.data?.hasUpstream ?? choice.hasUpstream);
  const action = publishing ? 'Publish branch' : 'Push commits';
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSelect(null); }}>
      <DialogPopup className="undo-commit-dialog">
        <div className="undo-commit-content">
          <DialogTitle>{publishing ? 'Publish branch' : 'Confirm push'}</DialogTitle>
          <DialogDescription>Review the credentials and destination for <strong>{choice.result.branch}</strong> in {choice.label}.{publishing ? ' Publishing also sets an upstream for this branch.' : ''} This review is remembered on this client until the account or destination changes.</DialogDescription>
          <Select value={remote} onValueChange={(value) => setRemote(value ?? '')}>
            <SelectTrigger aria-label="Push to remote"><SelectValue /></SelectTrigger>
            <SelectContent>{choice.result.remotes.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
          {context.data && <div className="repository-access-status"><p><strong>{gitHttpsModeLabel(context.data.mode, context.data.login)}</strong></p>{context.data.mode === 'external' && <p className="github-settings-note">Git uses credentials on {gitCredentialsLocation()}. They may belong to a different account from the one selected for GitHub and pull requests.</p>}<p>{context.data.urls.join(', ')}</p><p>{context.data.targetRef}</p>{context.data.blocked && <p role="alert">{context.data.blocked}</p>}</div>}
          {context.error && <p role="alert">Could not resolve the destination. Close and try again.</p>}
        </div>
        <div className="undo-commit-actions">
          <Button variant="ghost" onClick={() => onSelect(null)}>Cancel</Button>
          <Button disabled={!context.data || !!context.data.blocked || context.isFetching} onClick={() => onSelect(context.data ?? null)}>{action}</Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
