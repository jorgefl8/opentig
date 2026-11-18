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
  /**
   * `acceptKept`: for a read, the client can show an answer the server kept, marked
   * as old, while the server reads it again. Sent only to a server whose identity has
   * `keptReads`; an older server ignores it.
   */
  | { type: 'request'; id: string; command: string; args: unknown[]; acceptKept?: true }
  /**
   * Stops a read the client no longer needs. Sent only to a server whose identity has
   * `requestCancellation`; the result still arrives, and the client ignores it.
   */
  | { type: 'cancel'; id: string }
  | { type: 'ping' };

export type OpenTigServerMessage =
  /**
   * `kept`: the value is an answer the server kept, given by GitHub at `readAt`, and is
   * being read again. Only for a request with `acceptKept`; a `github.read-refreshed`
   * event naming the request follows on the same connection.
   */
  | { type: 'result'; id: string; result: IpcResult<unknown>; kept?: { readAt: string } }
  | { type: 'event'; event: OpenTigRuntimeEvent }
  | { type: 'pong' };

export interface OpenTigServerIdentity {
  profile?: ApplicationProfile;
  protocolVersion: number;
  appVersion: string;
  /** Understands `{ type: 'cancel' }`. Absent on servers older than that message. */
  requestCancellation?: true;
  /** Understands `acceptKept` on a request. Absent on servers older than it. */
  keptReads?: true;
  /** Answers `repository:snapshot`. Absent on servers older than it. */
  repositorySnapshots?: true;
  /** Answers `github:action-job-log`. Absent on servers older than it. */
  actionJobLogs?: true;
  /** Answers `commits:file-history`. Absent on servers older than it. */
  fileHistory?: true;
  /** Answers `github:pr-files` and `github:pr-file-diff`. Absent on servers older than them. */
  pullRequestFiles?: true;
  /**
   * Each connection has its own open repository: opening one, in any way, changes it for that
   * connection only, `bootstrap` opens the one a client asks for, and a repository's changes and
   * watch announcements go only to the connections that have it open. Absent on servers older
   * than it, where every client shares one repository.
   */
  repositoryPerClient?: true;
  /**
   * Answers `refs:repair-worktree`, and reports a worktree whose link to the repository is broken
   * (`brokenLink`) or whose changes Git can't read (`unreadable`). Absent on servers older than it.
   */
  worktreeRepair?: true;
  /** Answers `github:commit-author-avatar`. Absent on servers older than it. */
  commitAuthorAvatars?: true;
}
