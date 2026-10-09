import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { sileo, type SileoOptions } from 'sileo';
import { SplashScreen } from '@/components/SplashScreen';
import { Button } from '@/components/ui/button';
import { PairingCommand } from '@/features/auth/PairingCommand';
import { maintainBrowserSession } from '@/features/auth/session-renewal';
import { serverClient } from '@/lib/opentig-api';
import type { ServerConnectionState } from '@/lib/websocket-transport';

const COPY: Record<ServerConnectionState, string> = {
  connecting: 'Connecting to OpenTig server…',
  connected: 'Server connected',
  reconnecting: 'Reconnecting to OpenTig server…',
  'auth-required': 'Authentication required',
  'incompatible-version': 'Client and server versions are incompatible',
  offline: 'OpenTig server is offline',
};
let nextConnectionToastId = 0;

export function ServerConnectionBoundary({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    serverClient.transport.subscribeState,
    serverClient.transport.getState,
    serverClient.transport.getState,
  );
  const [connectedBefore, setConnectedBefore] = useState(false);
  const toastId = useRef<string | null>(null);

  useEffect(() => {
    if (state === 'connected' && !window.opentigDesktop) return maintainBrowserSession();
  }, [state]);

  useEffect(() => {
    if (connectedBefore && state !== 'connected' && state !== 'auth-required') {
      // Update one notification throughout an outage, without replacing other
      // app notifications. A fresh ID after recovery also isolates Sileo's
      // pending exit animation from a new, immediately following outage.
      const options: SileoOptions & { id: string } = {
        id: toastId.current ?? `server-connection:${++nextConnectionToastId}`,
        title: COPY[state],
        type: state === 'connecting' || state === 'reconnecting' ? 'warning' : 'error',
        position: 'bottom-right',
        duration: null,
        autopilot: false,
        ...(state === 'incompatible-version'
          ? { button: { title: 'Reload', onClick: () => window.location.reload() } }
          : {}),
      };
      toastId.current = sileo.show(options);
    } else if (toastId.current) {
      sileo.dismiss(toastId.current);
      toastId.current = null;
    }
  }, [connectedBefore, state]);

  useEffect(() => () => {
    if (toastId.current) sileo.dismiss(toastId.current);
    toastId.current = null;
  }, []);

  useEffect(() => {
    if (state === 'connected') setConnectedBefore(true);
    document.documentElement.dataset.serverConnection = state;
    return () => { delete document.documentElement.dataset.serverConnection; };
  }, [state]);

  if (state === 'auth-required') {
    const desktop = Boolean(window.opentigDesktop);
    return (
      <main className="access-page flex min-h-dvh items-center justify-center bg-background px-4 py-6 text-foreground">
        <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm" role="status">
          <h1 className="text-lg font-semibold">Authentication required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {desktop ? 'Restart OpenTig to restore its private desktop session.' : (
              <>If Web access is paused, enable it in Settings → Web access and reload to resume your saved session. New browsers and expired or revoked sessions need a pairing code from the desktop app or the command below.</>
            )}
          </p>
          {!desktop && (
            <>
              <PairingCommand />
              <Button className="mt-5" nativeButton={false} render={<a href="/pair" />}>Check browser access</Button>
            </>
          )}
        </section>
      </main>
    );
  }

  if (!connectedBefore && (state === 'offline' || state === 'incompatible-version')) {
    return (
      <SplashScreen
        heading={state === 'offline' ? 'OpenTig server is offline' : 'OpenTig cannot continue'}
        detail={state === 'offline'
          ? 'See the server log for details, then restart OpenTig.'
          : 'Client and server versions are incompatible.'}
        busy={false}
      />
    );
  }

  return children;
}
