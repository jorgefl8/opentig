import { chmod, readFile } from 'node:fs/promises';
import path from 'node:path';

export const AUTH_DATA_VERSION = 4;
export const BROWSER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface PersistedSession {
  id: string;
  digest: string;
  kind: 'desktop' | 'browser' | 'legacy';
  clientName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  os: string | null;
  browser: string | null;
  remoteAddress: string | null;
  viaProxy: boolean;
  createdAt: string;
  expiresAt: string | null;
  lastConnectedAt: string | null;
}

export interface PersistedAuthData {
  version: typeof AUTH_DATA_VERSION;
  sessions: PersistedSession[];
}

/** Read existing browser metadata without issuing credentials or starting auth. */
export async function hasActiveBrowserSessions(directory: string, now: () => number = Date.now): Promise<boolean> {
  const { sessions } = await loadSessions(path.join(directory, 'sessions.json'));
  return sessions.some((session) => session.kind !== 'desktop'
    && session.expiresAt !== null && now() < Date.parse(session.expiresAt));
}

export async function loadSessions(filePath: string): Promise<{ sessions: PersistedSession[]; migrated: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (isLegacyAuthData(parsed)) {
      await chmod(filePath, 0o600);
      return {
        sessions: parsed.sessions.map((session) => ({
          ...session,
          kind: 'legacy',
          expiresAt: sessionExpiry('legacy', session.createdAt),
          clientName: 'Legacy browser session',
          deviceType: 'unknown',
          os: null,
          browser: null,
          remoteAddress: null,
          viaProxy: false,
          lastConnectedAt: null,
        })),
        migrated: true,
      };
    }
    if (isVersionTwoAuthData(parsed)) {
      await chmod(filePath, 0o600);
      return {
        sessions: parsed.sessions.map((session) => ({
          ...session,
          expiresAt: sessionExpiry(session.kind, session.createdAt),
          clientName: session.kind === 'legacy' ? 'Legacy browser session' : session.clientName,
          deviceType: session.kind === 'desktop' ? 'desktop' : 'unknown',
          os: null,
          browser: session.kind === 'browser' ? session.clientName : null,
          viaProxy: false,
          lastConnectedAt: null,
        })),
        migrated: true,
      };
    }
    if (isVersionThreeAuthData(parsed)) {
      await chmod(filePath, 0o600);
      return {
        sessions: parsed.sessions.map((session) => ({ ...session, expiresAt: sessionExpiry(session.kind, session.createdAt) })),
        migrated: true,
      };
    }
    if (!isAuthData(parsed)) throw corrupt('session data');
    await chmod(filePath, 0o600);
    return { sessions: parsed.sessions.map((session) => ({ ...session })), migrated: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessions: [], migrated: false };
    if (error instanceof SyntaxError) throw corrupt('session data');
    throw error;
  }
}

function isAuthData(value: unknown): value is PersistedAuthData {
  const data = value as Partial<PersistedAuthData> | null;
  return Boolean(data
    && data.version === AUTH_DATA_VERSION
    && isVersionThreeAuthData({ ...data, version: 3 })
    && data.sessions?.every((session) => session.kind === 'desktop'
      ? session.expiresAt === null
      : typeof session.expiresAt === 'string'
        && Number.isFinite(Date.parse(session.expiresAt))
        && Date.parse(session.expiresAt) > Date.parse(session.createdAt)));
}

interface VersionThreeAuthData {
  version: 3;
  sessions: Array<Omit<PersistedSession, 'expiresAt'>>;
}

function isVersionThreeAuthData(value: unknown): value is VersionThreeAuthData {
  const data = value as Partial<VersionThreeAuthData> | null;
  return Boolean(data
    && data.version === 3
    && Array.isArray(data.sessions)
    && data.sessions.every((session) => (
      session
      && typeof session.id === 'string'
      && /^[A-Za-z0-9_-]{24}$/.test(session.id)
      && typeof session.digest === 'string'
      && /^[A-Za-z0-9_-]{43}$/.test(session.digest)
      && (session.kind === 'desktop' || session.kind === 'browser' || session.kind === 'legacy')
      && typeof session.clientName === 'string'
      && session.clientName.length > 0
      && session.clientName.length <= 160
      && (session.deviceType === 'desktop' || session.deviceType === 'mobile' || session.deviceType === 'tablet' || session.deviceType === 'bot' || session.deviceType === 'unknown')
      && (session.os === null || (typeof session.os === 'string' && session.os.length <= 80))
      && (session.browser === null || (typeof session.browser === 'string' && session.browser.length <= 80))
      && (session.remoteAddress === null || (typeof session.remoteAddress === 'string' && session.remoteAddress.length <= 128))
      && typeof session.viaProxy === 'boolean'
      && typeof session.createdAt === 'string'
      && !Number.isNaN(Date.parse(session.createdAt))
      && (session.lastConnectedAt === null || (typeof session.lastConnectedAt === 'string' && !Number.isNaN(Date.parse(session.lastConnectedAt))))
    )));
}

interface VersionTwoAuthData {
  version: 2;
  sessions: Array<Pick<PersistedSession, 'id' | 'digest' | 'kind' | 'clientName' | 'remoteAddress' | 'createdAt'>>;
}

function isVersionTwoAuthData(value: unknown): value is VersionTwoAuthData {
  const data = value as Partial<VersionTwoAuthData> | null;
  return Boolean(data
    && data.version === 2
    && Array.isArray(data.sessions)
    && data.sessions.every((session) => (
      session
      && typeof session.id === 'string'
      && /^[A-Za-z0-9_-]{24}$/.test(session.id)
      && typeof session.digest === 'string'
      && /^[A-Za-z0-9_-]{43}$/.test(session.digest)
      && (session.kind === 'desktop' || session.kind === 'browser' || session.kind === 'legacy')
      && typeof session.clientName === 'string'
      && session.clientName.length > 0
      && session.clientName.length <= 160
      && (session.remoteAddress === null || (typeof session.remoteAddress === 'string' && session.remoteAddress.length <= 128))
      && typeof session.createdAt === 'string'
      && !Number.isNaN(Date.parse(session.createdAt))
    )));
}

interface LegacyAuthData {
  version: 1;
  sessions: Array<Pick<PersistedSession, 'id' | 'digest' | 'createdAt'>>;
}

function isLegacyAuthData(value: unknown): value is LegacyAuthData {
  const data = value as Partial<LegacyAuthData> | null;
  return Boolean(data
    && data.version === 1
    && Array.isArray(data.sessions)
    && data.sessions.every((session) => (
      session
      && typeof session.id === 'string'
      && /^[A-Za-z0-9_-]{24}$/.test(session.id)
      && typeof session.digest === 'string'
      && /^[A-Za-z0-9_-]{43}$/.test(session.digest)
      && typeof session.createdAt === 'string'
      && !Number.isNaN(Date.parse(session.createdAt))
    )));
}

function corrupt(name: string): Error {
  return new Error(`OpenTig authentication ${name} is corrupt.`);
}

export function sessionExpiry(kind: PersistedSession['kind'], createdAt: string): string | null {
  return kind === 'desktop' ? null : new Date(Date.parse(createdAt) + BROWSER_SESSION_MAX_AGE_SECONDS * 1_000).toISOString();
}
