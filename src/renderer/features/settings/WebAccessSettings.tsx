import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconBrowser,
  IconCopy,
  IconDeviceDesktop,
  IconEdit,
  IconLink,
  IconLoader4,
  IconQrcode,
  IconShieldLock,
  IconTrash,
} from '@tabler/icons-react';
import { renderSVG } from 'uqr';
import { sileo } from 'sileo';
import type { OpenTigPairingLink, OpenTigWebAccessStatus } from '@shared/desktop-api';
import type { OpenTigOwnerSession } from '@shared/server-protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { loadOwnerSessions, renameOwnerSession, revokeAllBrowserSessions, revokeOwnerSession } from './owner-sessions';

const STATUS_COPY: Record<OpenTigWebAccessStatus['serverState'], string> = {
  starting: 'Starting',
  ready: 'Ready',
  restarting: 'Restarting',
  failed: 'Failed',
  stopped: 'Stopped',
};

type Action = 'toggle' | 'pair' | 'revoke-all' | `rename:${string}` | `revoke:${string}`;

export function WebAccessSettings() {
  const desktopApi = window.opentigDesktop?.webAccess;
  const [status, setStatus] = useState<OpenTigWebAccessStatus | null>(null);
  const [sessions, setSessions] = useState<OpenTigOwnerSession[]>([]);
  const [pairing, setPairing] = useState<OpenTigPairingLink | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [enableWarningOpen, setEnableWarningOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<OpenTigOwnerSession | 'all' | null>(null);
  const [renameTarget, setRenameTarget] = useState<OpenTigOwnerSession | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const loadState = useCallback(async (showErrors = true) => {
    const results = await Promise.allSettled([
      desktopApi?.getStatus() ?? Promise.resolve(null),
      loadOwnerSessions(),
    ]);
    if (results[0].status === 'fulfilled') setStatus(results[0].value);
    else if (showErrors) sileo.error({ title: 'Could not read web access status', description: messageOf(results[0].reason) });
    if (results[1].status === 'fulfilled') setSessions(results[1].value);
    else if (showErrors) sileo.error({ title: 'Could not read owner sessions', description: messageOf(results[1].reason) });
    setLoading(false);
  }, [desktopApi]);

  useEffect(() => {
    void loadState();
    const timer = window.setInterval(() => void loadState(false), 2_000);
    return () => window.clearInterval(timer);
  }, [loadState]);

  useEffect(() => {
    if (!status) return;
    if (!status.pairingEndpoints.length) setSelectedEndpoint('');
    else if (!status.pairingEndpoints.includes(selectedEndpoint)) setSelectedEndpoint(status.pairingEndpoints[0]!);
  }, [selectedEndpoint, status]);

  const qrSource = useMemo(() => pairing
    ? `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(renderSVG(pairing.url, { ecc: 'M', border: 2 }))}`
    : null, [pairing]);
  const pairingCode = useMemo(() => pairing
    ? new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('token') ?? ''
    : '', [pairing]);

  if (loading && (!desktopApi || !status) && sessions.length === 0) {
    return <div className="web-access-loading" role="status"><IconLoader4 className="animate-spin" /> Loading web access…</div>;
  }

  const changeExposure = async (enabled: boolean) => {
    if (!desktopApi) return;
    setAction('toggle');
    setPairing(null);
    try {
      setStatus(await desktopApi.setEnabled(enabled));
      sileo.success({ title: enabled ? 'LAN access enabled' : 'LAN access disabled' });
    } catch (error) {
      sileo.error({ title: 'Could not restart web access', description: messageOf(error) });
      await loadState(false);
    } finally {
      setAction(null);
      setEnableWarningOpen(false);
    }
  };

  const createLink = async () => {
    if (!desktopApi) return;
    setAction('pair');
    try { setPairing(await desktopApi.createPairingLink(selectedEndpoint)); }
    catch (error) { sileo.error({ title: 'Could not create pairing link', description: messageOf(error) }); }
    finally { setAction(null); }
  };

  const copyLink = async () => {
    if (!pairing) return;
    try {
      await writeClipboardText(pairing.url);
      sileo.success({ title: 'Pairing link copied' });
    } catch (error) { sileo.error({ title: 'Could not copy pairing link', description: messageOf(error) }); }
  };

  const copyCode = async () => {
    if (!pairingCode) return;
    try {
      await writeClipboardText(pairingCode);
      sileo.success({ title: 'Pairing code copied' });
    } catch (error) { sileo.error({ title: 'Could not copy pairing code', description: messageOf(error) }); }
  };

  const renameConfirmed = async () => {
    const target = renameTarget;
    const name = renameInput.trim();
    if (!target || !name || name.length > 64) return;
    setAction(`rename:${target.id}`);
    try {
      await renameOwnerSession(target.id, name);
      sileo.success({ title: 'Device renamed' });
      await loadState(false);
      setRenameTarget(null);
    } catch (error) { sileo.error({ title: 'Could not rename device', description: messageOf(error) }); }
    finally { setAction(null); }
  };

  const revokeConfirmed = async () => {
    const target = revokeTarget;
    if (!target) return;
    const nextAction: Action = target === 'all' ? 'revoke-all' : `revoke:${target.id}`;
    setAction(nextAction);
    try {
      const count = target === 'all'
        ? await revokeAllBrowserSessions()
        : await revokeOwnerSession(target.id);
      setPairing(null);
      sileo.success({ title: `${count} browser ${count === 1 ? 'session' : 'sessions'} revoked` });
      await loadState(false);
    } catch (error) { sileo.error({ title: 'Could not revoke session', description: messageOf(error) }); }
    finally {
      setAction(null);
      setRevokeTarget(null);
    }
  };

  const ready = status?.serverState === 'ready';
  const browserSessions = sessions.filter((session) => session.kind !== 'desktop');

  return (
    <div className="web-access-settings">
      {desktopApi && status && <>
        <div className="web-access-summary">
          <div className="settings-field-label">
            <strong>LAN access</strong>
            <span>Listen on this computer&apos;s network interfaces for trusted local devices.</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="LAN access"
            aria-checked={status.enabled}
            className="settings-switch"
            disabled={action === 'toggle' || !ready}
            onClick={() => status.enabled ? void changeExposure(false) : setEnableWarningOpen(true)}
          ><span /></button>
        </div>

        <div className="web-access-facts" aria-live="polite">
          <WebAccessFact label="Server status"><Badge variant={ready ? 'secondary' : 'outline'}>{STATUS_COPY[status.serverState]}</Badge></WebAccessFact>
          <WebAccessFact label="Actual port"><code>{status.actualPort ?? 'Unavailable'}</code></WebAccessFact>
          <WebAccessFact label="Local endpoint"><Endpoint value={status.localEndpoint} /></WebAccessFact>
          <WebAccessFact label="LAN endpoints">
            <div className="web-access-endpoints">
              {status.networkEndpoints.length === 0
                ? <span>None detected</span>
                : status.networkEndpoints.map((endpoint) => <Endpoint key={endpoint} value={endpoint} muted={!status.enabled} />)}
            </div>
          </WebAccessFact>
        </div>

        {status.restartError && <div className="web-access-error" role="alert"><IconAlertTriangle /> <span>{status.restartError}</span></div>}

        <div className="web-access-actions settings-field-separated">
          <div className="settings-field-label">
            <strong>Pair a browser</strong>
            <span>Create a five-minute, one-use link for this computer or a LAN device. The pairing code also works through a same-machine HTTPS tunnel.</span>
          </div>
          <Button size="sm" onClick={() => void createLink()} disabled={!ready || !selectedEndpoint || action !== null}>
            {action === 'pair' ? <IconLoader4 className="animate-spin" /> : <IconLink />} Create pairing link
          </Button>
        </div>
        {status.pairingEndpoints.length > 0 && (
          <div className="web-access-endpoint-select">
            <label htmlFor="web-access-endpoint">Address to place in the pairing link</label>
            <Select value={selectedEndpoint} onValueChange={(endpoint) => { if (endpoint) { setSelectedEndpoint(endpoint); setPairing(null); } }} disabled={action !== null}>
              <SelectTrigger id="web-access-endpoint" className="w-full"><SelectValue>{selectedEndpoint}</SelectValue></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>{status.pairingEndpoints.map((endpoint) => <SelectItem key={endpoint} value={endpoint}>{endpoint}</SelectItem>)}</SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}

        {pairing && (
          <div className="web-access-pairing" role="status">
            <div className="web-access-pairing-copy"><IconQrcode aria-hidden="true" /><div><strong>Pairing link ready</strong><span>Expires {new Date(pairing.expiresAt).toLocaleString()}.</span></div></div>
            {qrSource && <img src={qrSource} alt="QR code for the one-use OpenTig pairing link" />}
            <div className="web-access-link-row">
              <Tooltip><TooltipTrigger render={<code className="web-access-link" />}>{pairing.url}</TooltipTrigger><TooltipContent side="bottom">One-use link; do not share publicly</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Copy pairing link" onClick={() => void copyLink()} />}><IconCopy /></TooltipTrigger><TooltipContent>Copy pairing link</TooltipContent></Tooltip>
            </div>
            <div className="web-access-link-row">
              <Tooltip><TooltipTrigger render={<code className="web-access-link" />}>{pairingCode}</TooltipTrigger><TooltipContent side="bottom">Paste this code on any /pair page served by this OpenTig instance</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Copy pairing code" onClick={() => void copyCode()} />}><IconCopy /></TooltipTrigger><TooltipContent>Copy pairing code</TooltipContent></Tooltip>
            </div>
          </div>
        )}
      </>}

      <div className={`web-access-session-heading ${desktopApi ? 'settings-field-separated' : ''}`}>
        <div className="settings-field-label">
          <strong>Owner sessions</strong>
          <span>Desktop authentication stays private. Paired browsers can be disconnected individually.</span>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setRevokeTarget('all')} disabled={browserSessions.length === 0 || action !== null}>
          <IconShieldLock /> Revoke browsers
        </Button>
      </div>

      <div className="web-access-session-list" aria-live="polite">
        {sessions.length === 0
          ? <div className="web-access-empty-session">No owner sessions found.</div>
          : sessions.map((session) => (
            <div className="web-access-session" key={session.id}>
              <div className={`web-access-session-icon ${session.connected ? 'connected' : ''}`}>
                {session.kind === 'desktop' ? <IconDeviceDesktop /> : <IconBrowser />}
              </div>
              <div className="web-access-session-copy">
                <div><strong>{session.clientName}</strong>{session.current && <Badge variant="secondary">This session</Badge>}{session.kind === 'desktop' && <Badge variant="outline">Desktop</Badge>}</div>
                <span>{session.connected ? `Connected${session.connectionCount > 1 ? ` (${session.connectionCount} tabs)` : ''}` : session.lastConnectedAt ? `Last connected ${formatDate(session.lastConnectedAt)}` : 'Not yet connected'} · {session.browser && session.os ? `${session.browser} on ${session.os}` : session.browser ?? session.os ?? deviceLabel(session.deviceType)}{session.viaProxy ? ' · Via proxy' : ''}{session.remoteAddress ? ` · ${session.remoteAddress}` : ''}</span>
              </div>
              {session.kind !== 'desktop' && (
                <div className="web-access-session-controls">
                  <Tooltip>
                    <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Rename ${session.clientName}`} onClick={() => { setRenameTarget(session); setRenameInput(session.clientName); }} disabled={action !== null} />}><IconEdit /></TooltipTrigger>
                    <TooltipContent>Rename this device</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Revoke ${session.clientName} session`} onClick={() => setRevokeTarget(session)} disabled={action !== null} />}><IconTrash /></TooltipTrigger>
                    <TooltipContent>Revoke this browser session</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          ))}
      </div>

      {!desktopApi && <p className="web-access-hint">Listener addresses and new pairing links are controlled by the OpenTig desktop app or CLI running the server.</p>}

      <Dialog open={enableWarningOpen} onOpenChange={setEnableWarningOpen}>
        <DialogPopup className="web-access-warning-dialog">
          <div className="web-access-warning-content"><IconAlertTriangle /><div><DialogTitle>Enable owner-level LAN access?</DialogTitle><DialogDescription>Any paired browser can edit or delete files and act with your OS user permissions. Use only a trusted LAN or VPN.</DialogDescription></div></div>
          <div className="web-access-warning-actions"><DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose><Button size="sm" onClick={() => void changeExposure(true)} disabled={action !== null}>Enable LAN access</Button></div>
        </DialogPopup>
      </Dialog>

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <DialogPopup className="web-access-warning-dialog">
          <div className="web-access-warning-content"><IconShieldLock /><div><DialogTitle>{revokeTarget === 'all' ? 'Revoke all browser sessions?' : 'Revoke this browser session?'}</DialogTitle><DialogDescription>{revokeTarget === 'all' ? 'Every paired browser disconnects immediately. The private desktop session remains signed in.' : revokeTarget?.current ? 'This browser will disconnect immediately and require a new pairing link.' : 'That browser disconnects immediately and will require a new pairing link.'}</DialogDescription></div></div>
          <div className="web-access-warning-actions"><DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose><Button variant="destructive" size="sm" onClick={() => void revokeConfirmed()} disabled={action !== null}>Revoke</Button></div>
        </DialogPopup>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogPopup className="web-access-warning-dialog">
          <div className="web-access-rename-content"><DialogTitle>Rename paired device</DialogTitle><DialogDescription>Use a name that makes this browser easy to identify later.</DialogDescription></div>
          <input className="web-access-rename-input" value={renameInput} onChange={(event) => setRenameInput(event.target.value)} maxLength={64} aria-label="Device name" autoComplete="off" />
          <div className="web-access-warning-actions"><DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose><Button size="sm" onClick={() => void renameConfirmed()} disabled={action !== null || !renameInput.trim()}>Save</Button></div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

function WebAccessFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="web-access-fact"><span>{label}</span><div>{children}</div></div>;
}

function Endpoint({ value, muted = false }: { value: string | null; muted?: boolean }) {
  if (!value) return <span>Unavailable</span>;
  return <Tooltip><TooltipTrigger render={<code className={muted ? 'muted' : undefined} />}>{value}</TooltipTrigger><TooltipContent side="bottom">{muted ? 'Enable LAN access to use this endpoint' : value}</TooltipContent></Tooltip>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString();
}

function deviceLabel(type: OpenTigOwnerSession['deviceType']): string {
  return type === 'desktop' ? 'Desktop browser' : type === 'mobile' ? 'Mobile browser' : type === 'tablet' ? 'Tablet browser' : type === 'bot' ? 'Automated client' : 'Unknown browser';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
