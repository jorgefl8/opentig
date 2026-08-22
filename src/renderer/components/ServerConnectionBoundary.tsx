import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IconLoader4 } from '@tabler/icons-react';
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

  if (!connectedBefore && state !== 'connected') {
    return (
      <div className="splash" role="status">
        {(state === 'connecting' || state === 'reconnecting') && <IconLoader4 className="spinner" />}
        <span>{COPY[state]}</span>
      </div>
    );
  }

  return (
    <>
      {children}
      <div className={`server-connection-state ${state}`} role="status" aria-live="polite">
        <span className="server-connection-dot" aria-hidden="true" />
        {COPY[state]}
      </div>
    </>
  );
}
