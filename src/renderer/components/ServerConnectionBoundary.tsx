import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SplashScreen } from '@/components/SplashScreen';
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

export function ServerConnectionBoundary({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    serverClient.transport.subscribeState,
    serverClient.transport.getState,
    serverClient.transport.getState,
  );
  const [connectedBefore, setConnectedBefore] = useState(false);

  useEffect(() => {
    if (state === 'connected') setConnectedBefore(true);
    document.documentElement.dataset.serverConnection = state;
    return () => { delete document.documentElement.dataset.serverConnection; };
  }, [state]);

  if (state === 'auth-required') {
    const desktop = Boolean(window.opentigDesktop);
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm" role="status">
          <h1 className="text-lg font-semibold">Authentication required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {desktop
              ? 'Restart OpenTig to restore its private desktop session.'
              : 'Create a fresh pairing link in desktop OpenTig under Settings → Web Access, then open that link in this browser.'}
          </p>
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

  return (
    <>
      {children}
      {connectedBefore && state !== 'connected' && (
        <div className={`server-connection-state ${state}`} role="status" aria-live="polite">
          <span className="server-connection-dot" aria-hidden="true" />
          {COPY[state]}
        </div>
      )}
    </>
  );
}
