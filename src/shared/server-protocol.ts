import type { IpcResult } from './contracts';
import type { OpenTigRuntimeEvent } from './runtime-events';

export const OPEN_TIG_PROTOCOL_VERSION = 1;
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
