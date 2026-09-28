import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RemoteChoice } from './useBranchPush';

export function PublishRemoteDialog({ choice, onSelect }: { choice: RemoteChoice; onSelect(remote: string | null): void }) {
  const [remote, setRemote] = useState(choice.result.remotes[0] ?? '');
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onSelect(null); }}>
      <DialogPopup className="undo-commit-dialog">
        <div className="undo-commit-content">
          <DialogTitle>Publish branch</DialogTitle>
          <DialogDescription>Choose the remote for <strong>{choice.result.branch}</strong> in {choice.label}. Publishing also sets its upstream.</DialogDescription>
          <Select value={remote} onValueChange={(value) => setRemote(value ?? '')}>
            <SelectTrigger aria-label="Publish to remote"><SelectValue /></SelectTrigger>
            <SelectContent>{choice.result.remotes.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="undo-commit-actions">
          <Button variant="ghost" onClick={() => onSelect(null)}>Cancel</Button>
          <Button disabled={!remote} onClick={() => onSelect(remote)}>Publish branch</Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
