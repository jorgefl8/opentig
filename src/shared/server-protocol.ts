import type { IpcResult } from './contracts';
import type { OpenTigRuntimeEvent } from './runtime-events';
import protocolMetadata from './protocol-version.json';

export const OPEN_TIG_PROTOCOL_VERSION = protocolMetadata.protocolVersion;
export const OPEN_TIG_SESSION_COOKIE = 'opentig_session';

export type OpenTigOwnerSessionKind = 'desktop' | 'browser' | 'legacy';
export type OpenTigDeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';

export interface OpenTigOwnerSession {
  id: string;
  kind: OpenTigOwnerSessionKind;
  clientName: string;
  deviceType: OpenTigDeviceType;
  os: string | null;
  browser: string | null;
  remoteAddress: string | null;
  viaProxy: boolean;
  createdAt: string;
  lastConnectedAt: string | null;
  connected: boolean;
  connectionCount: number;
  current: boolean;
}

export type OpenTigClientMessage =
  | { type: 'request'; id: string; command: string; args: unknown[] }
  | { type: 'ping' };

export type OpenTigServerMessage =
  | { type: 'result'; id: string; result: IpcResult<unknown> }
  | { type: 'event'; event: OpenTigRuntimeEvent }
  | { type: 'pong' };

export interface OpenTigServerIdentity {
  protocolVersion: number;
  appVersion: string;
}
