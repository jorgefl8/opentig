import { useEffect, useState } from 'react';
import type { DesktopUpdateStatus } from '../../../shared/desktop-updates';
import { Popover } from '@base-ui/react/popover';
import { IconCheck, IconExclamationMark, IconRefresh } from '@tabler/icons-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';

function useUpdateStatus(interval: number) {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const api = window.opentigDesktop?.updates;
    if (!api) return;
    let active = true;
    const refresh = () => { void api.getStatus().then((next) => {
      if (active) { setStatus(next); setError(null); }
    }).catch(() => { if (active) setError('Could not read update status. Try reopening settings.'); }); };
    refresh();
    const timer = window.setInterval(refresh, interval);
    return () => { active = false; window.clearInterval(timer); };
  }, [interval]);
  return { status, setStatus, error, setError };
}

export function UpdateSettings() {
  const { status, setStatus, error, setError } = useUpdateStatus(1_000);
  const [pending, setPending] = useState(false);
  const api = window.opentigDesktop?.updates;
  if (!api) return <p className="text-sm text-muted-foreground">Open the desktop app to manage its updates. This browser uses the version running on your server.</p>;
  if (!status) return <p role="status">{error ?? 'Checking update settings…'}</p>;
  const action = async (kind: 'check' | 'download' | 'install') => {
    setPending(true); setError(null);
    try { setStatus(await api[kind]()); }
    catch { setError('The update action could not be completed. Try again.'); }
    finally { setPending(false); }
  };
  const busy = pending || ['checking', 'downloading', 'installing'].includes(status.phase);
  return <div className="settings-field">
    <div className="settings-field-label">
      <strong>OpenTig {status.currentVersion}</strong>
      <span>{status.phase === 'unavailable' ? 'This build does not check for automatic updates.' : 'Stable releases are checked at startup, every 30 minutes, and when returning to the app if a check is due. Download and restart when you are ready.'}</span>
    </div>
    <p className="text-sm" role="status" aria-live="polite">{error ?? status.message ?? updateCopy(status)}</p>
    {status.phase === 'downloading' && <progress className="w-full" aria-label="Update download" max={100} value={status.progress ?? 0} />}
    <div className="flex flex-wrap items-center gap-2">
      {['idle', 'error', 'checking'].includes(status.phase) && <Button variant="outline" disabled={busy} onClick={() => void action('check')}>{status.phase === 'checking' ? 'Checking…' : 'Check for updates'}</Button>}
      {status.phase === 'available' && <Button disabled={busy} onClick={() => void action('download')}>Download {status.availableVersion}</Button>}
      {status.phase === 'ready' && <Button disabled={busy} onClick={() => void action('install')}>Restart and install</Button>}
      {status.releaseUrl && <a className="text-sm underline" href={status.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>}
    </div>
    {status.checkedAt && <p className="text-xs text-muted-foreground">Last checked: {new Date(status.checkedAt).toLocaleString()}</p>}
    {status.phase === 'ready' && <p className="text-xs text-muted-foreground">Save your edits and finish Git operations before restarting. Closing normally will not install the update.</p>}
  </div>;
}

/** Remains reachable even after the floating notice is dismissed. */
export function DesktopUpdateIndicator() {
  const { status } = useUpdateStatus(1_000);
  if (!status || ['idle', 'checking', 'unavailable'].includes(status.phase)) return null;
  const spinning = status.phase === 'downloading' || status.phase === 'installing';
  const label = status.message ?? updateCopy(status);
  return <Popover.Root>
    <Tooltip>
      <TooltipTrigger render={<Popover.Trigger render={<Button variant="ghost" size="icon-sm" className="desktop-update-indicator relative" aria-label={`Updates: ${label}`} />} />}>
        <IconRefresh className={spinning ? 'animate-spin' : undefined} />
        <span className={`absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full border-2 border-background ${status.phase === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`} aria-hidden="true">
          {status.phase === 'ready' ? <IconCheck className="size-2.5!" /> : status.phase === 'error' ? <IconExclamationMark className="size-2.5!" /> : <span className="size-1 rounded-full bg-current" />}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="end" sideOffset={8} className="isolate z-50 outline-none">
        <Popover.Popup className="w-[min(24rem,calc(100vw-2rem))] max-h-[var(--available-height)] overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg" aria-label="Desktop updates">
          <UpdateSettings />
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}

export function DesktopUpdateNotice() {
  const { status } = useUpdateStatus(10_000);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!status || (!open && (!['available', 'ready'].includes(status.phase) || dismissed === `${status.phase}:${status.availableVersion}`))) return null;
  return <aside className="fixed bottom-4 right-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg" aria-label="OpenTig update">
    {open ? <UpdateSettings /> : <p className="text-sm">{updateCopy(status)}</p>}
    <div className="flex gap-2">
      {!open && <Button size="sm" onClick={() => setOpen(true)}>View update</Button>}
      <Button size="sm" variant="ghost" onClick={() => { setDismissed(`${status.phase}:${status.availableVersion}`); setOpen(false); }}>Later</Button>
    </div>
  </aside>;
}

function updateCopy(status: DesktopUpdateStatus): string {
  switch (status.phase) {
    case 'available': return `OpenTig ${status.availableVersion} is available.`;
    case 'downloading': return `Downloading… ${Math.round(status.progress ?? 0)}%`;
    case 'ready': return `OpenTig ${status.availableVersion} is ready to install.`;
    case 'checking': return 'Checking for a new stable release…';
    case 'installing': return 'Closing OpenTig to install the update…';
    case 'idle': return status.checkedAt ? 'You are using the latest stable version.' : 'No update check has completed yet.';
    default: return status.message ?? 'Updates are unavailable.';
  }
}
