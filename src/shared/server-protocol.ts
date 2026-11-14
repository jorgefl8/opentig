import type { IpcResult } from './contracts';
import type { OpenTigRuntimeEvent } from './runtime-events';
import type { ApplicationProfile } from './application-profile';
import protocolMetadata from './protocol-version.json';

export const OPEN_TIG_PROTOCOL_VERSION = protocolMetadata.protocolVersion;
export const OPEN_TIG_SESSION_COOKIE = 'opentig_session';
/** UTF-8 JSON bytes, including the envelope and escaped strings. */
export const OPEN_TIG_MAX_SERVER_MESSAGE_BYTES = 4 * 1024 * 1024;
/** Requests one connection may have running on the server. One more is refused before it runs. */
export const OPEN_TIG_MAX_IN_FLIGHT_REQUESTS = 32;
/** What a client sends at once. Below the server's limit, so the rest wait in the client instead of being refused. */
export const OPEN_TIG_CLIENT_MAX_IN_FLIGHT_REQUESTS = 24;
/** How many of those may be background work, which leaves the others for what the user is doing. */
export const OPEN_TIG_CLIENT_MAX_BACKGROUND_REQUESTS = 8;

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
  profile?: ApplicationProfile;
  protocolVersion: number;
  appVersion: string;
}
