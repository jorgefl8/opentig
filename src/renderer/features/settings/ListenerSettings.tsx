import { useEffect, useState } from 'react';
import type { OpenTigWebAccessStatus } from '@shared/desktop-api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { updateBrowserWebAccess } from './browser-web-access';
import { canRestartForUpdate } from './update-api';

export function ListenerSettings({ status, disabled, onChange }: {
  status: OpenTigWebAccessStatus;
  disabled: boolean;
  onChange(status: OpenTigWebAccessStatus): void;
}) {
  const [host, setHost] = useState(status.listenerHost ?? (status.listeningOnLan ? '0.0.0.0' : '127.0.0.1'));
  const [port, setPort] = useState(String(status.actualPort ?? ''));
  const [confirmation, setConfirmation] = useState<{ listenerHost: string; listenerPort: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setHost(status.listenerHost ?? (status.listeningOnLan ? '0.0.0.0' : '127.0.0.1')); }, [status.listenerHost, status.listeningOnLan]);
  useEffect(() => { setPort(String(status.actualPort ?? '')); }, [status.actualPort]);
  const changed = host.trim() !== (status.listenerHost ?? (status.listeningOnLan ? '0.0.0.0' : '127.0.0.1')) || Number(port) !== status.actualPort;
  const apply = async () => {
    if (!confirmation) return;
    setPending(true);
    setError(null);
    try {
      if (!canRestartForUpdate()) throw new Error('Save your edited files and finish running operations before changing the listener.');
      onChange(await updateBrowserWebAccess(confirmation)); setConfirmation(null);
    }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not change the listener.'); setConfirmation(null); }
    finally { setPending(false); }
  };
  return <details className="web-access-connection-details settings-field-separated">
    <summary>Connection details <span>Edit listener</span></summary>
    <form className="web-access-listener-form" onSubmit={(event) => {
      event.preventDefault();
      setError(null);
      if (changed) setConfirmation({ listenerHost: host.trim(), listenerPort: Number(port) });
    }}>
      <label htmlFor="web-access-listener-host">Listening address</label>
      <input id="web-access-listener-host" className="web-access-rename-input" value={host} onChange={(event) => setHost(event.target.value)} required maxLength={45} disabled={disabled || pending} autoComplete="off" spellCheck={false} aria-describedby="web-access-listener-help" />
      <label htmlFor="web-access-listener-port">Port</label>
      <input id="web-access-listener-port" className="web-access-rename-input" type="number" min="1" max="65535" step="1" value={port} onChange={(event) => setPort(event.target.value)} required disabled={disabled || pending} />
      <p id="web-access-listener-help" className="web-access-hint">Use 127.0.0.1 for a tunnel on this server, 0.0.0.0 for all IPv4 interfaces, or a specific IPv4/IPv6 address. Changing the listener may disconnect browsers. Tunnel routing is configured separately.</p>
      {error && <p className="web-access-error" role="alert">{error}</p>}
      <div><Button type="submit" variant="outline" size="sm" disabled={disabled || pending || !changed}>Apply listener</Button></div>
    </form>
    <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !pending) setConfirmation(null); }}>
      <DialogPopup className="undo-commit-dialog">
        <div className="undo-commit-content">
          <DialogTitle>Change listening address?</DialogTitle>
          <DialogDescription>This changes the listener for every client. Save edits on connected clients first. Direct connections may need the new address and port; a tunnel may need its origin updated. Paired devices stay saved. If the new address or port cannot be used, OpenTig restores the previous listener.</DialogDescription>
          <p className="web-access-hint"><code>{confirmation?.listenerHost}:{confirmation?.listenerPort}</code></p>
          {status.recoveryCommand && <p className="web-access-hint">If you lose access, run <code>{status.recoveryCommand}</code> on the server and restart this instance.</p>}
        </div>
        <div className="undo-commit-actions">
          <Button variant="ghost" disabled={pending} onClick={() => setConfirmation(null)}>Cancel</Button>
          <Button disabled={pending} onClick={() => void apply()}>{pending ? 'Applying…' : 'Change listener'}</Button>
        </div>
      </DialogPopup>
    </Dialog>
  </details>;
}
