import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DesktopUpdateStatus } from '../../../shared/desktop-updates';
import { Popover } from '@base-ui/react/popover';
import { IconAlertTriangle, IconCheck, IconDownload, IconExternalLink, IconLoader2, IconRefresh } from '@tabler/icons-react';
import { summarizeUpdateReleaseNotes } from './update-release-notes';
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
      <span>{status.phase === 'unavailable' ? 'This build does not check for automatic updates.' : 'Stable releases are checked at startup, every 5 minutes, and when returning to the app if a check is due. Download and restart when you are ready.'}</span>
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
  const { status, setStatus, error, setError } = useUpdateStatus(1_000);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const actionPending = useRef(false);
  const suppressFocus = useRef(false);
  const triggerId = useId();
  const releaseLink = useRef<HTMLAnchorElement>(null);
  const notes = useMemo(() => summarizeUpdateReleaseNotes(status?.releaseNotes), [status?.releaseNotes]);
  if (!status || ['idle', 'checking', 'unavailable'].includes(status.phase)) return null;
  const unavailable = pending || status.phase === 'downloading' || status.phase === 'installing';
  const label = status.phase === 'available'
    ? `Update ${status.availableVersion} is available. Click to download.`
    : status.phase === 'ready'
      ? `Update ${status.availableVersion} downloaded. Click to restart and install.`
      : status.phase === 'error' ? 'Update failed. Click to retry.' : updateCopy(status);
  const progress = Math.max(0, Math.min(100, status.progress ?? 0));
  const act = async () => {
    const api = window.opentigDesktop?.updates;
    if (!api || unavailable || actionPending.current) return;
    actionPending.current = true;
    setPending(true);
    setError(null);
    // The icon is the action; the hover card is only release information.
    const action = status.phase === 'available' ? 'download' : status.phase === 'ready' ? 'install' : 'check';
    try { setStatus(await api[action]()); }
    catch { setError('The update action could not be completed. Click the icon to retry.'); }
    finally { actionPending.current = false; setPending(false); }
  };
  return <Popover.Root open={open} triggerId={triggerId} onOpenChange={(next, details) => {
    if (details.reason === 'trigger-press') { details.cancel(); return; }
    if (!next && details.reason === 'escape-key') suppressFocus.current = true;
    setOpen(next);
  }}>
    <Popover.Trigger id={triggerId} openOnHover delay={300} closeDelay={150}
      render={<Button variant="ghost" size="icon-sm" className="desktop-update-indicator relative" aria-label={label} aria-disabled={unavailable || undefined}
        onClick={() => void act()}
        onFocus={(event) => {
          if (suppressFocus.current) { suppressFocus.current = false; return; }
          if (event.currentTarget.matches(':focus-visible')) setOpen(true);
        }}
        onBlur={() => { suppressFocus.current = false; }}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && !event.shiftKey && open && releaseLink.current) {
            event.preventDefault(); releaseLink.current.focus();
          }
        }} />}
    >
      {status.phase === 'available' || status.phase === 'downloading' ? <IconDownload /> : status.phase === 'installing' ? <IconLoader2 className="animate-spin" /> : status.phase === 'error' ? <IconAlertTriangle /> : <IconRefresh />}
      {status.phase === 'downloading' && <svg className="pointer-events-none absolute inset-0 size-full! -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
        <circle cx="16" cy="16" r="14" pathLength="100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100 - progress} className="transition-[stroke-dashoffset] motion-reduce:transition-none" />
      </svg>}
      {status.phase === 'ready' && <span className="absolute -bottom-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground" aria-hidden="true"><IconCheck className="size-2.5!" /></span>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="end" sideOffset={8} className="isolate z-50 outline-none">
        <Popover.Popup initialFocus={false} className="desktop-update-card flex w-[min(25rem,calc(100vw-2rem))] max-h-[var(--available-height)] flex-col gap-4 overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl" aria-label="Update details">
          <p className="text-sm font-medium" aria-live="polite">{label}</p>
          {(error || status.message) && <p className="text-xs text-muted-foreground" role="status">{error ?? status.message}</p>}
          <section className="min-h-0 text-xs">
            <h3 className="mb-2 font-medium">What's changed</h3>
            {notes.items.length > 0 ? <ul className="list-disc space-y-2 pl-4 leading-relaxed text-muted-foreground">
              {notes.items.map((item, index) => <li key={index} className="break-words">{item}</li>)}
            </ul> : <p className="text-muted-foreground">No release notes were provided for this update.</p>}
          </section>
          {status.releaseUrl && <a ref={releaseLink} className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground" href={status.releaseUrl} target="_blank" rel="noreferrer">
            {notes.omitted ? `${notes.omitted} more ${notes.omitted === 1 ? 'change' : 'changes'} on GitHub` : 'View release on GitHub'}<IconExternalLink className="size-3" />
          </a>}
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
