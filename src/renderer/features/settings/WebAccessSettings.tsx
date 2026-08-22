import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconCopy,
  IconLink,
  IconLoader4,
  IconQrcode,
  IconRefresh,
  IconShieldLock,
} from '@tabler/icons-react';
import { renderSVG } from 'uqr';
import { sileo } from 'sileo';
import type { OpenTigPairingLink, OpenTigWebAccessStatus } from '@shared/desktop-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { writeClipboardText } from '@/lib/browser-capabilities';

const STATUS_COPY: Record<OpenTigWebAccessStatus['serverState'], string> = {
  starting: 'Starting',
  ready: 'Ready',
  restarting: 'Restarting',
  failed: 'Failed',
  stopped: 'Stopped',
};

export function WebAccessSettings() {
  const api = window.opentigDesktop?.webAccess;
  const [status, setStatus] = useState<OpenTigWebAccessStatus | null>(null);
  const [pairing, setPairing] = useState<OpenTigPairingLink | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'toggle' | 'pair' | 'revoke' | null>(null);
  const [enableWarningOpen, setEnableWarningOpen] = useState(false);
  const [revokeWarningOpen, setRevokeWarningOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!api) return;
    try { setStatus(await api.getStatus()); }
    catch (error) { sileo.error({ title: 'Could not read Web Access status', description: messageOf(error) }); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.networkEndpoints.length) {
      setSelectedEndpoint('');
      return;
    }
    if (!status.networkEndpoints.includes(selectedEndpoint)) setSelectedEndpoint(status.networkEndpoints[0]!);
  }, [selectedEndpoint, status]);

  const qrSource = useMemo(() => pairing
    ? `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(renderSVG(pairing.url, { ecc: 'M', border: 2 }))}`
    : null, [pairing]);

  if (!api) return <p className="web-access-unavailable">Network access can only be changed from the OpenTig desktop app.</p>;
  if (loading && !status) return <div className="web-access-loading" role="status"><IconLoader4 className="animate-spin" /> Loading network status…</div>;
  if (!status) return <Button variant="outline" size="sm" onClick={() => void loadStatus()}><IconRefresh /> Try again</Button>;

  const ready = status.serverState === 'ready';
  const networkReady = status.enabled && ready && status.networkEndpoints.includes(selectedEndpoint);

  const changeExposure = async (enabled: boolean) => {
    setAction('toggle');
    setPairing(null);
    try {
      setStatus(await api.setEnabled(enabled));
      sileo.success({ title: enabled ? 'Network access enabled' : 'Network access disabled' });
    } catch (error) {
      sileo.error({ title: 'Could not restart Web Access', description: messageOf(error) });
      await loadStatus();
    } finally {
      setAction(null);
      setEnableWarningOpen(false);
    }
  };

  const createLink = async () => {
    setAction('pair');
    try { setPairing(await api.createPairingLink(selectedEndpoint)); }
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

  const revokeSessions = async () => {
    setAction('revoke');
    try {
      const result = await api.revokeAllSessions();
      setPairing(null);
      sileo.success({ title: `${result.revokedCount} owner ${result.revokedCount === 1 ? 'session' : 'sessions'} revoked` });
      await loadStatus();
    } catch (error) { sileo.error({ title: 'Could not revoke sessions', description: messageOf(error) }); }
    finally {
      setAction(null);
      setRevokeWarningOpen(false);
    }
  };

  return (
    <div className="web-access-settings">
      <div className="web-access-summary">
        <div className="settings-field-label">
          <strong>Network access</strong>
          <span>Use this same OpenTig backend from another browser on your network.</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Network access"
          aria-checked={status.enabled}
          className="settings-switch"
          disabled={action === 'toggle' || !ready}
          onClick={() => status.enabled ? void changeExposure(false) : setEnableWarningOpen(true)}
        ><span /></button>
      </div>

      <div className="web-access-facts" aria-live="polite">
        <WebAccessFact label="Server status"><Badge variant={ready ? 'secondary' : 'outline'}>{STATUS_COPY[status.serverState]}</Badge></WebAccessFact>
        <WebAccessFact label="Actual port"><code>{status.actualPort ?? 'Unavailable'}</code></WebAccessFact>
        <WebAccessFact label="Connected owner sessions"><strong>{status.connectedSessionCount}</strong></WebAccessFact>
        <WebAccessFact label="Local endpoint"><Endpoint value={status.localEndpoint} /></WebAccessFact>
        <WebAccessFact label="Network endpoints">
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
          <span>Creates a five-minute, one-use link. Creating another link invalidates the previous one.</span>
        </div>
        <Button size="sm" onClick={() => void createLink()} disabled={!networkReady || action !== null}>
          {action === 'pair' ? <IconLoader4 className="animate-spin" /> : <IconLink />} Create pairing link
        </Button>
      </div>
      {status.networkEndpoints.length > 1 && (
        <div className="web-access-endpoint-select">
          <label htmlFor="web-access-endpoint">Address to place in the pairing link</label>
          <Select
            value={selectedEndpoint}
            onValueChange={(endpoint) => {
              if (!endpoint) return;
              setSelectedEndpoint(endpoint);
              setPairing(null);
            }}
            disabled={!status.enabled || action !== null}
          >
            <SelectTrigger id="web-access-endpoint" className="w-full">
              <SelectValue>{selectedEndpoint}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {status.networkEndpoints.map((endpoint) => <SelectItem key={endpoint} value={endpoint}>{endpoint}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

      {pairing && (
        <div className="web-access-pairing" role="status">
          <div className="web-access-pairing-copy">
            <IconQrcode aria-hidden="true" />
            <div>
              <strong>Pairing link ready</strong>
              <span>Expires {new Date(pairing.expiresAt).toLocaleString()}.</span>
            </div>
          </div>
          {qrSource && <img src={qrSource} alt="QR code for the one-use OpenTig pairing link" />}
          <div className="web-access-link-row">
            <Tooltip>
              <TooltipTrigger render={<code className="web-access-link" />}>{pairing.url}</TooltipTrigger>
              <TooltipContent side="bottom">One-use link; do not share publicly</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Copy pairing link" onClick={() => void copyLink()} />}><IconCopy /></TooltipTrigger>
              <TooltipContent>Copy pairing link</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      <div className="web-access-actions settings-field-separated">
        <div className="settings-field-label">
          <strong>Owner sessions</strong>
          <span>Disconnect every paired browser. OpenTig immediately replaces its private desktop session.</span>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setRevokeWarningOpen(true)} disabled={!ready || action !== null}>
          <IconShieldLock /> Revoke all sessions
        </Button>
      </div>

      <Dialog open={enableWarningOpen} onOpenChange={setEnableWarningOpen}>
        <DialogPopup className="web-access-warning-dialog">
          <div className="web-access-warning-content">
            <IconAlertTriangle />
            <div>
              <DialogTitle>Enable owner-level network access?</DialogTitle>
              <DialogDescription>
                Any paired browser can edit or delete files, run Git, GitHub and AI CLIs, and act with your OS user permissions. Use only a trusted LAN or VPN, an HTTPS reverse proxy, or an SSH tunnel. Never expose the raw port publicly.
              </DialogDescription>
            </div>
          </div>
          <div className="web-access-warning-actions">
            <DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose>
            <Button size="sm" onClick={() => void changeExposure(true)} disabled={action !== null}>Enable network access</Button>
          </div>
        </DialogPopup>
      </Dialog>

      <Dialog open={revokeWarningOpen} onOpenChange={setRevokeWarningOpen}>
        <DialogPopup className="web-access-warning-dialog">
          <div className="web-access-warning-content">
            <IconShieldLock />
            <div>
              <DialogTitle>Revoke all owner sessions?</DialogTitle>
              <DialogDescription>Every paired browser disconnects immediately. Pairing links already created remain one-use but should be replaced.</DialogDescription>
            </div>
          </div>
          <div className="web-access-warning-actions">
            <DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose>
            <Button variant="destructive" size="sm" onClick={() => void revokeSessions()} disabled={action !== null}>Revoke sessions</Button>
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
  return (
    <Tooltip>
      <TooltipTrigger render={<code className={muted ? 'muted' : undefined} />}>{value}</TooltipTrigger>
      <TooltipContent side="bottom">{muted ? 'Enable network access to use this endpoint' : value}</TooltipContent>
    </Tooltip>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
