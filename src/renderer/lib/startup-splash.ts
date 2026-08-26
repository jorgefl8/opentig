import type { ServerConnectionState } from './websocket-transport';

export function startupSplashDetail(state: ServerConnectionState): string {
  if (state === 'connected') return 'Restoring your workspace.';
  if (state === 'reconnecting') return 'Reconnecting to the local server.';
  return 'Connecting to the local server.';
}
