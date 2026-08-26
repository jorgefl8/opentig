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

const SPLASH: Record<Exclude<ServerConnectionState, 'connected' | 'auth-required'>, { heading: string; detail: string }> = {
  connecting: { heading: 'Starting OpenTig…', detail: 'Connecting to the local server.' },
  reconnecting: { heading: 'Starting OpenTig…', detail: 'Reconnecting to OpenTig server…' },
  'incompatible-version': { heading: 'OpenTig cannot continue', detail: 'Client and server versions are incompatible.' },
  offline: { heading: 'OpenTig server is offline', detail: 'See the server log for details, then restart OpenTig.' },
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

  if (!connectedBefore && state !== 'connected') {
    const splash = SPLASH[state];
    return <SplashScreen heading={splash.heading} detail={splash.detail} />;
  }

  return (
    <>
      {children}
      {state !== 'connected' && (
        <div className={`server-connection-state ${state}`} role="status" aria-live="polite">
          <span className="server-connection-dot" aria-hidden="true" />
          {COPY[state]}
        </div>
      )}
    </>
  );
}
