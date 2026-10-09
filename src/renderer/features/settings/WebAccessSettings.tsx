import { formatDateTime } from '@shared/date-format';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { normalizePairingOrigin } from '@shared/web-access';
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
  IconX,
} from '@tabler/icons-react';
import { renderSVG } from 'uqr';
import { sileo } from 'sileo';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import type { OpenTigPairingLink, OpenTigWebAccessStatus } from '@shared/desktop-api';
import type { OpenTigOwnerSession } from '@shared/server-protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { writeClipboardText } from '@/lib/browser-capabilities';
import { loadOwnerSessions, renameOwnerSession, revokeAllBrowserSessions, revokeOwnerSession } from './owner-sessions';
import { PairingRequests } from './web-access-pairing';
import { browserConfiguration, browserWebAccessApi, loadBrowserWebAccessStatus } from './browser-web-access';
import { ListenerSettings } from './ListenerSettings';
import { canRestartForUpdate } from './update-api';

const STATUS_COPY: Record<OpenTigWebAccessStatus['serverState'], string> = {
  starting: 'Starting',
  ready: 'Ready',
  restarting: 'Restarting',
  failed: 'Failed',
  stopped: 'Stopped',
};

type Action = 'toggle' | 'lan' | 'origin' | 'revoke-all' | `rename:${string}` | `revoke:${string}`;
type PairingDestination = 'current' | 'local' | 'lan' | 'public';

export function WebAccessSettings() {
  const isBrowser = !window.opentigDesktop?.webAccess;
  const accessApi = window.opentigDesktop?.webAccess ?? browserWebAccessApi;
  const [status, setStatus] = useState<OpenTigWebAccessStatus | null>(null);
  const [sessions, setSessions] = useState<OpenTigOwnerSession[]>([]);
  const [pairing, setPairing] = useState<OpenTigPairingLink | null>(null);
  const [destination, setDestination] = useState<PairingDestination>(isBrowser ? 'current' : 'local');
  const [lanEndpoint, setLanEndpoint] = useState('');
  const [editingPublicOrigin, setEditingPublicOrigin] = useState(false);
  const [publicOriginInput, setPublicOriginInput] = useState('');
  const [originError, setOriginError] = useState<string | null>(null);
  const originInput = useRef<HTMLInputElement>(null);
  const [pairingPending, setPairingPending] = useState(false);
  const [pairingVisible, setPairingVisible] = useState(false);
  const [pairingRequest, setPairingRequest] = useState<number | null>(null);
  const requests = useRef(new PairingRequests());
  const displayedRequest = useRef<number | null>(null);
  const mounted = useRef(true);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [exposureConfirmation, setExposureConfirmation] = useState<'enable' | 'disable' | null>(null);
  const [lanConfirmation, setLanConfirmation] = useState<boolean | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<OpenTigOwnerSession | 'all' | null>(null);
  const [renameTarget, setRenameTarget] = useState<OpenTigOwnerSession | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const lanEndpoints = status?.webAccessEnabled && status.listeningOnLan
    ? status.networkEndpoints.filter((endpoint) => status.pairingEndpoints.includes(endpoint)) : [];
  const selectedEndpoint = destination === 'current' ? window.location.origin : destination === 'public' ? status?.publicOrigin ?? ''
    : destination === 'lan' ? lanEndpoint : status?.localEndpoint ?? '';
  const showOriginEditor = destination === 'public' && (!status?.publicOrigin || editingPublicOrigin);
  const webAccessEnabled = status?.webAccessEnabled;
  const canCreateLink = webAccessEnabled && status?.serverState === 'ready'
    && (destination === 'current' || status.pairingEndpoints.includes(selectedEndpoint))
    && !showOriginEditor && action === null && !pairingPending;
  const destinations: { value: PairingDestination; label: string }[] = [
    ...(isBrowser ? [{ value: 'current' as const, label: 'Current address' }] : []),
    { value: 'local', label: 'Local' },
    ...(lanEndpoints.length ? [{ value: 'lan' as const, label: 'LAN' }] : []),
    { value: 'public', label: 'My domain' },
  ];
  const dismissPairing = useCallback(() => {
    requests.current.dismiss();
    displayedRequest.current = null;
    setPairing(null);
    setPairingVisible(false);
  }, []);

  useEffect(() => {
    const currentRequests = requests.current;
    mounted.current = true;
    return () => { mounted.current = false; currentRequests.dismiss(); };
  }, []);
  useEffect(() => { setPublicOriginInput(status?.publicOrigin ?? ''); }, [status?.publicOrigin]);
  useEffect(() => {
    if (webAccessEnabled === false) {
      dismissPairing();
      setEditingPublicOrigin(false);
      setOriginError(null);
      setPublicOriginInput(status?.publicOrigin ?? '');
    }
  }, [webAccessEnabled, status?.publicOrigin, dismissPairing]);
  useEffect(() => { if (webAccessEnabled && showOriginEditor) originInput.current?.focus(); }, [webAccessEnabled, showOriginEditor]);
  useEffect(() => { dismissPairing(); }, [selectedEndpoint, dismissPairing]);
  useEffect(() => {
    if (!pairing || pairingRequest === null) return;
    const timer = window.setTimeout(() => {
      if (requests.current.isCurrent(pairingRequest)) dismissPairing();
    }, Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pairing, pairingRequest, dismissPairing]);

  const loadState = useCallback(async (showErrors = true) => {
    const displayed = displayedRequest.current;
    const results = await Promise.allSettled([
      !isBrowser ? accessApi.getStatus().then((value) => { if (mounted.current) setStatus(value); })
        : loadBrowserWebAccessStatus().then((value) => {
          if (!mounted.current) return;
          setStatus(browserConfiguration(value));
          if (!value.pairingAvailable && displayed !== null && requests.current.isCurrent(displayed)) dismissPairing();
        }),
      loadOwnerSessions(),
    ]);
    if (!mounted.current) return;
    if (results[0].status === 'rejected' && showErrors) sileo.error({ title: 'Could not read web access status', description: messageOf(results[0].reason) });
    if (results[1].status === 'fulfilled') setSessions(results[1].value);
    else if (showErrors) sileo.error({ title: 'Could not read owner sessions', description: messageOf(results[1].reason) });
    setLoading(false);
  }, [accessApi, isBrowser, dismissPairing]);

  useEffect(() => {
    void loadState();
    const timer = window.setInterval(() => void loadState(false), 2_000);
    return () => window.clearInterval(timer);
  }, [loadState]);

  useEffect(() => {
    if (!status) return;
    const endpoints = status.listeningOnLan ? status.networkEndpoints.filter((endpoint) => status.pairingEndpoints.includes(endpoint)) : [];
    if (!endpoints.includes(lanEndpoint)) setLanEndpoint(endpoints[0] ?? '');
    if (destination === 'lan' && endpoints.length === 0) setDestination('local');
  }, [lanEndpoint, destination, status]);

  const qrSource = useMemo(() => pairing
    ? `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(renderSVG(pairing.url, { ecc: 'M', border: 2 }))}`
    : null, [pairing]);
  const pairingCode = useMemo(() => pairing
    ? new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('token') ?? ''
    : '', [pairing]);

  if (loading && !status && sessions.length === 0) {
    return <div className="web-access-loading" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /><ShimmeringText text="Loading web access…" /></div>;
  }

  const changeExposure = async (enabled: boolean) => {
    setAction('toggle');
    dismissPairing();
    try {
      if (isBrowser && !enabled && !canRestartForUpdate()) throw new Error('Save your edited files and finish running operations before pausing web access.');
      setStatus(await accessApi.setEnabled(enabled));
      sileo.success({ title: enabled ? 'Web access enabled' : 'Web access paused; paired devices saved' });
    } catch (error) {
      sileo.error({ title: 'Could not change web access', description: messageOf(error) });
      await loadState(false);
    } finally {
      setAction(null);
      setExposureConfirmation(null);
    }
  };

  const changeLan = async (enabled: boolean) => {
    setAction('lan');
    dismissPairing();
    try {
      if (!canRestartForUpdate()) throw new Error('Save your edited files and finish running operations before changing LAN access.');
      setStatus(await accessApi.setLanEnabled(enabled));
    }
    catch (error) { sileo.error({ title: 'Could not change LAN access', description: messageOf(error) }); await loadState(false); }
    finally { setAction(null); }
  };

  const savePublicOrigin = async (clear = false) => {
    setOriginError(null);
    let origin: string;
    try {
      const input = publicOriginInput.trim();
      origin = clear ? '' : normalizePairingOrigin(input && !input.includes('://') ? `https://${input}` : input);
    }
    catch (error) { setOriginError(messageOf(error)); return; }
    setAction('origin');
    dismissPairing();
    try {
      const updated = await accessApi.setPublicOrigin(origin);
      setStatus(updated);
      setPublicOriginInput(updated.publicOrigin ?? '');
      setEditingPublicOrigin(false);
      setDestination(updated.publicOrigin ? 'public' : 'local');
    } catch (error) { setOriginError(messageOf(error)); }
    finally { setAction(null); }
  };

  const chooseDestination = (next: PairingDestination) => {
    dismissPairing();
    setDestination(next);
    setEditingPublicOrigin(false);
    setPublicOriginInput(status?.publicOrigin ?? '');
    setOriginError(null);
  };

  const cancelOriginEdit = () => {
    setPublicOriginInput(status?.publicOrigin ?? '');
    setOriginError(null);
    setEditingPublicOrigin(false);
    if (!status?.publicOrigin) setDestination('local');
  };

  const createLink = async () => {
    if (!canCreateLink) return;
    const request = requests.current.begin();
    if (request === null) return;
    setPairing(null);
    setPairingRequest(request);
    setPairingVisible(true);
    setPairingPending(true);
    try {
      const result = await accessApi.createPairingLink(selectedEndpoint);
      if (mounted.current && requests.current.isCurrent(request)) {
        displayedRequest.current = request;
        setPairing(result);
      }
    } catch (error) {
      if (mounted.current && requests.current.isCurrent(request)) {
        setPairingVisible(false);
        sileo.error({ title: 'Could not create pairing link', description: messageOf(error) });
      }
    } finally {
      requests.current.finish(request);
      if (mounted.current) setPairingPending(false);
    }
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
      {status && <>
        <div className="web-access-summary">
          <div className="settings-field-label">
            <strong>Web access</strong>
            <span>Allow paired browsers to use OpenTig. Turning this off disconnects browsers but keeps paired devices. {isBrowser ? 'Restore access from the desktop app or with the local recovery command below.' : 'Enable it again to restore their access; the desktop stays connected.'}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Web access"
            aria-checked={status.webAccessEnabled}
            className="settings-switch"
            disabled={action !== null || !ready}
            onClick={() => setExposureConfirmation(status.webAccessEnabled ? 'disable' : 'enable')}
          ><span /></button>
        </div>
        {isBrowser && status.recoveryCommand && <p className="web-access-hint">Local recovery: <code>{status.recoveryCommand}</code>, then restart this instance. For a custom CLI home, add --home. Paired devices are preserved.</p>}

        <div className="web-access-facts" aria-live="polite">
          <WebAccessFact label="Server status"><Badge variant={ready ? 'secondary' : 'outline'}>{STATUS_COPY[status.serverState]}</Badge></WebAccessFact>
          <WebAccessFact label="Actual port"><code>{status.actualPort ?? 'Unavailable'}</code></WebAccessFact>
          <WebAccessFact label="Listening on"><span>{status.listenerHost ?? (status.listeningOnLan ? 'All network interfaces' : 'This computer (loopback)')}</span></WebAccessFact>
          <WebAccessFact label="Local endpoint"><Endpoint value={status.localEndpoint} /></WebAccessFact>
          <div className="web-access-summary web-access-network-settings">
            <div className="settings-field-label">
              <strong>LAN access</strong>
              <span>Allow direct connections from the server&apos;s network. A tunnel on the same host works with LAN access off. Changing LAN access reconnects clients.</span>
            </div>
            <button type="button" role="switch" aria-label="LAN access" aria-checked={status.listeningOnLan} className="settings-switch"
              disabled={!status.webAccessEnabled || action !== null || !ready} onClick={() => isBrowser ? setLanConfirmation(!status.listeningOnLan) : void changeLan(!status.listeningOnLan)}><span /></button>
          </div>
          <WebAccessFact label="LAN endpoints">
            <div className="web-access-endpoints">
              {status.networkEndpoints.length === 0
                ? <span>None detected</span>
                : status.networkEndpoints.map((endpoint) => <Endpoint key={endpoint} value={endpoint} muted={!status.webAccessEnabled || !status.listeningOnLan} />)}
            </div>
          </WebAccessFact>
        </div>

        <ListenerSettings status={status} disabled={action !== null || !ready} onChange={setStatus} />

        {status.restartError && <div className="web-access-error" role="alert"><IconAlertTriangle /> <span>{status.restartError}</span></div>}

        {!status.webAccessEnabled && <p className="web-access-hint">Browser access is paused, including through tunnels. Paired devices are saved; the private desktop session stays connected.</p>}

      </>}

      {webAccessEnabled && <>
        <div className="web-access-actions settings-field-separated">
          <div className="settings-field-label">
            <strong>Pair a browser</strong>
            <span>Choose where to open your five-minute, one-use link.</span>
          </div>
        </div>
        <div className="web-access-pairing-options">
          {status && <>
            <fieldset className="web-access-destinations" disabled={action !== null}>
              <legend className="sr-only">Pairing destination</legend>
              {destinations.map(({ value, label }) => (
                <label key={value}>
                  <input type="radio" name="web-access-destination" value={value} checked={destination === value} onChange={() => chooseDestination(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            {destination === 'public' ? (
              <div className="web-access-domain">
                {showOriginEditor ? <form onSubmit={(event) => { event.preventDefault(); void savePublicOrigin(); }}>
                  <label htmlFor="web-access-public-origin">Your domain</label>
                  <input ref={originInput} id="web-access-public-origin" className="web-access-rename-input" value={publicOriginInput}
                    onChange={(event) => { setPublicOriginInput(event.target.value); setOriginError(null); }} placeholder="https://git.example.com"
                    aria-invalid={originError !== null} aria-describedby={`web-access-origin-help${originError ? ' web-access-origin-error' : ''}`}
                    maxLength={2_048} disabled={action !== null} autoComplete="off" spellCheck={false} inputMode="url" />
                  <p id="web-access-origin-help" className="web-access-hint">Your tunnel address, without a path. It will be used in the link and QR. Point your tunnel at the local endpoint shown above.</p>
                  {originError && <p id="web-access-origin-error" className="web-access-error" role="alert">{originError}</p>}
                  <div className="web-access-domain-actions">
                    <Button type="submit" size="sm" disabled={action !== null || !publicOriginInput.trim()}>Save and use</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={cancelOriginEdit} disabled={action !== null}>Cancel</Button>
                    {status.publicOrigin && <Button type="button" variant="ghost" size="sm" onClick={() => void savePublicOrigin(true)} disabled={action !== null}>Remove</Button>}
                  </div>
                </form> : <>
                  <div className="web-access-saved-domain">
                    <code>{status.publicOrigin}</code>
                    <Button variant="ghost" size="sm" onClick={() => { dismissPairing(); setEditingPublicOrigin(true); }} disabled={action !== null}><IconEdit /> Edit</Button>
                  </div>
                  <p className="web-access-hint">Saved and selected for this link and QR.</p>
                </>}
              </div>
            ) : destination === 'lan' ? (
              <div className="web-access-endpoint-select">
                <label htmlFor="web-access-endpoint">Network address</label>
                <Select value={lanEndpoint} onValueChange={(endpoint) => { if (endpoint) setLanEndpoint(endpoint); }} disabled={action !== null}>
                  <SelectTrigger id="web-access-endpoint" className="w-full"><SelectValue>{lanEndpoint}</SelectValue></SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>{lanEndpoints.map((endpoint) => <SelectItem key={endpoint} value={endpoint}>{endpoint}</SelectItem>)}</SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : <p className="web-access-hint">{destination === 'current' ? 'Use this browser’s address, including through a tunnel.' : 'For a browser on the server itself.'}</p>}
          </>}
          <div className="web-access-link-destination">
            <span>Address for the link and QR</span>
            <code>{selectedEndpoint || (destination === 'public' ? 'Add your domain above' : 'Unavailable')}</code>
          </div>
          <Button size="sm" onClick={() => void createLink()} disabled={!canCreateLink}>
            {pairingPending ? <IconLoader4 className="animate-spin" /> : <IconLink />} Create pairing link
          </Button>
        </div>

        {pairingVisible && (
          <div className="web-access-pairing" role="status">
            <div className="web-access-pairing-copy">
              {pairing ? <IconQrcode aria-hidden="true" /> : <IconLoader4 className="animate-spin" aria-hidden="true" />}
              <div><strong>{pairing ? 'Pairing link ready' : <ShimmeringText text="Creating pairing link…" />}</strong><span>{pairing ? `Expires ${formatDateTime(pairing.expiresAt, { seconds: true })}.` : 'You can close this while the link is being created.'}</span></div>
              <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Close pairing link" onClick={dismissPairing} />}><IconX /></TooltipTrigger><TooltipContent>Close pairing link</TooltipContent></Tooltip>
            </div>
            {pairing && <>
            {qrSource && <img src={qrSource} alt="QR code for the one-use OpenTig pairing link" />}
            <div className="web-access-link-row">
              <Tooltip><TooltipTrigger render={<code className="web-access-link" />}>{pairing.url}</TooltipTrigger><TooltipContent side="bottom">One-use link; do not share publicly</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Copy pairing link" onClick={() => void copyLink()} />}><IconCopy /></TooltipTrigger><TooltipContent>Copy pairing link</TooltipContent></Tooltip>
            </div>
            <div className="web-access-link-row">
              <Tooltip><TooltipTrigger render={<code className="web-access-link" />}>{pairingCode}</TooltipTrigger><TooltipContent side="bottom">Paste this code on any /pair page served by this OpenTig instance</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Copy pairing code" onClick={() => void copyCode()} />}><IconCopy /></TooltipTrigger><TooltipContent>Copy pairing code</TooltipContent></Tooltip>
            </div>
            <p className="web-access-hint">Closing hides this code. A copied code remains valid until used, replaced, or expired. Turning off Web access invalidates it.</p>
            </>}
          </div>
        )}
      </>}

      <div className="web-access-session-heading settings-field-separated">
        <div className="settings-field-label">
          <strong>Owner sessions</strong>
          <span>{isBrowser ? '' : 'Desktop authentication stays private. '}Paired browsers can be renamed or disconnected individually.</span>
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
                <span>{session.connected ? `Connected${session.connectionCount > 1 ? ` (${session.connectionCount} tabs)` : ''}` : session.lastConnectedAt ? `Last connected ${formatDateTime(session.lastConnectedAt, { seconds: true })}` : 'Not yet connected'} · {session.browser && session.os ? `${session.browser} on ${session.os}` : session.browser ?? session.os ?? deviceLabel(session.deviceType)}{session.viaProxy ? ' · Via proxy' : ''}{session.remoteAddress ? ` · ${session.remoteAddress}` : ''}</span>
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

      <Dialog open={lanConfirmation !== null} onOpenChange={(open) => { if (!open) setLanConfirmation(null); }}>
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>{lanConfirmation ? 'Enable LAN access?' : 'Disable LAN access?'}</DialogTitle>
            <DialogDescription>{lanConfirmation ? 'Other devices on the server’s network will be able to reach OpenTig. They still need pairing. Use a trusted LAN or VPN.' : 'Direct LAN connections will stop. If you use a LAN address, this browser will disconnect. A tunnel on the same server can still connect.'} Paired devices are preserved.</DialogDescription>
          </div>
          <div className="undo-commit-actions">
            <Button variant="ghost" onClick={() => setLanConfirmation(null)}>Cancel</Button>
            <Button onClick={() => { const enabled = lanConfirmation!; setLanConfirmation(null); void changeLan(enabled); }}>{lanConfirmation ? 'Enable LAN access' : 'Disable LAN access'}</Button>
          </div>
        </DialogPopup>
      </Dialog>
      <Dialog open={exposureConfirmation !== null} onOpenChange={(open) => { if (!open) setExposureConfirmation(null); }}>
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>{exposureConfirmation === 'disable' ? 'Disable Web access?' : 'Enable browser access?'}</DialogTitle>
            <DialogDescription>{exposureConfirmation === 'disable'
              ? `Connected browsers will disconnect and cannot access OpenTig until Web access is enabled again. Paired devices stay saved and can reconnect with their valid sessions. ${isBrowser ? 'You will lose access from this browser. Restore it from the desktop app, or run the recovery command on the server and restart it.' : 'The desktop stays connected.'}`
              : 'Paired browsers can edit or delete files and act with your OS user permissions. Saved paired devices can reconnect. Use only devices you trust. LAN exposure is configured separately.'}</DialogDescription>
          </div>
          <div className="undo-commit-actions">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button variant={exposureConfirmation === 'disable' ? 'destructive' : 'default'} onClick={() => void changeExposure(exposureConfirmation === 'enable')} disabled={action !== null || !ready}>
              {exposureConfirmation === 'disable' ? 'Disable Web access' : 'Enable Web access'}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>{revokeTarget === 'all' ? 'Revoke all browser sessions?' : 'Revoke this browser session?'}</DialogTitle>
            <DialogDescription>{revokeTarget === 'all' ? 'Every paired browser disconnects immediately. The private desktop session remains signed in.' : revokeTarget?.current ? 'This browser will disconnect immediately and require a new pairing link.' : 'That browser disconnects immediately and will require a new pairing link.'}</DialogDescription>
            {revokeTarget && revokeTarget !== 'all' && (
              <div className="undo-commit-summary"><strong>{revokeTarget.clientName}</strong></div>
            )}
          </div>
          <div className="undo-commit-actions">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={() => void revokeConfirmed()} disabled={action !== null}>
              <IconShieldLock /> Revoke
            </Button>
          </div>
        </DialogPopup>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogPopup className="undo-commit-dialog">
          <div className="undo-commit-content">
            <DialogTitle>Rename paired device</DialogTitle>
            <DialogDescription>Use a name that makes this browser easy to identify later.</DialogDescription>
            <input className="web-access-rename-input" value={renameInput} onChange={(event) => setRenameInput(event.target.value)} maxLength={64} aria-label="Device name" autoComplete="off" />
          </div>
          <div className="undo-commit-actions">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button onClick={() => void renameConfirmed()} disabled={action !== null || !renameInput.trim()}>Save</Button>
          </div>
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
  return <Tooltip><TooltipTrigger render={<code className={muted ? 'muted' : undefined} />}>{value}</TooltipTrigger><TooltipContent side="bottom">{muted ? 'Enable Web access and LAN access to use this endpoint' : value}</TooltipContent></Tooltip>;
}

function deviceLabel(type: OpenTigOwnerSession['deviceType']): string {
  return type === 'desktop' ? 'Desktop browser' : type === 'mobile' ? 'Mobile browser' : type === 'tablet' ? 'Tablet browser' : type === 'bot' ? 'Automated client' : 'Unknown browser';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
