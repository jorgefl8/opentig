import type { IpcResult } from './contracts';
import type { OpenTigRuntimeEvent } from './runtime-events';
import protocolMetadata from './protocol-version.json';

export const OPEN_TIG_PROTOCOL_VERSION = protocolMetadata.protocolVersion;
export const OPEN_TIG_SESSION_COOKIE = 'opentig_session';

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
