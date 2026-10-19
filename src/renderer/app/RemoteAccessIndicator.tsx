import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { RemoteAccessProblem } from '@shared/repository-access';
import { Button } from '@/components/ui/button';
import { remoteAccessActionLabel, remoteAccessCopy, type RemoteAccessAction } from '@/features/repositories/remote-access';

/** A persistent toolbar warning for a background fetch that GitHub refused, with the action that fixes it. */
export function RemoteAccessIndicator({ problem, message, compact = false, onAction }: {
  problem: RemoteAccessProblem;
  message: string;
  compact?: boolean;
  onAction(action: RemoteAccessAction): void;
}) {
  const [open, setOpen] = useState(false);
  const copy = remoteAccessCopy(problem);
  const act = (action: RemoteAccessAction) => { setOpen(false); onAction(action); };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger render={<button type="button" className="remote-access-indicator" aria-label={`Can’t fetch from the remote. ${copy.summary}`} />}>
      <IconAlertTriangle aria-hidden="true" />{!compact && <span>Can’t fetch</span>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="end" sideOffset={8} className="isolate z-50 outline-none">
        <Popover.Popup className="remote-access-card" aria-label="Remote access">
          <Popover.Title className="remote-access-title">Can’t fetch from the remote</Popover.Title>
          <p><strong>{copy.summary}</strong> {copy.detail}</p>
          <div className="remote-access-actions">
            <Button size="sm" onClick={() => act(copy.action)}>{remoteAccessActionLabel(copy.action)}</Button>
            {copy.action.kind !== 'settings' && <Button size="sm" variant="outline" onClick={() => act({ kind: 'settings' })}>Repository access</Button>}
          </div>
          <details className="remote-access-output"><summary>Git output</summary><pre>{message}</pre></details>
          <small>New remote commits stay hidden until access works. OpenTig keeps checking in the background.</small>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
