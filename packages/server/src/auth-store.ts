import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const AUTH_DATA_VERSION = 3;
const SECRET_BYTES = 32;
const SECRET_FILE = 'server-secret';
const SESSIONS_FILE = 'sessions.json';

interface PersistedSession {
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
  lastConnectedAt: string | null;
}

interface PersistedAuthData {
  version: typeof AUTH_DATA_VERSION;
  sessions: PersistedSession[];
}

export interface IssuedSession {
  id: string;
  token: string;
}

export interface SessionMetadata {
  kind: 'desktop' | 'browser';
  clientName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  os: string | null;
  browser: string | null;
  remoteAddress: string | null;
  viaProxy: boolean;
}

export type StoredSession = Omit<PersistedSession, 'digest'>;

/** Atomic, hash-only persistence for owner sessions. */
export class PersistentAuthStore {
  private sessions: PersistedSession[];
  private mutationQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly directory: string,
    private readonly secret: Buffer,
    sessions: PersistedSession[],
  ) {
    this.sessions = sessions;
  }

  static async open(directory: string): Promise<PersistentAuthStore> {
    const resolved = path.resolve(directory);
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    await chmod(resolved, 0o700);
    const secret = await loadOrCreateSecret(path.join(resolved, SECRET_FILE));
    const dataPath = path.join(resolved, SESSIONS_FILE);
    const { sessions, migrated } = await loadSessions(dataPath);
    const store = new PersistentAuthStore(resolved, secret, sessions);
    if (migrated || !(await exists(dataPath))) await store.writeSessions(sessions);
    return store;
  }

  digestCredential(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('base64url');
  }

  matchesDigest(token: string, expectedDigest: string): boolean {
    return constantTimeEqual(this.digestCredential(token), expectedDigest);
  }

  authenticate(token: string): string | null {
    const candidate = this.digestCredential(token);
    let sessionId: string | null = null;
    for (const session of this.sessions) {
      if (constantTimeEqual(candidate, session.digest)) sessionId ??= session.id;
    }
    return sessionId;
  }

  issue(metadata: SessionMetadata): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const session: PersistedSession = {
      id: randomBytes(18).toString('base64url'),
      digest: this.digestCredential(token),
      kind: metadata.kind,
      clientName: metadata.clientName,
      deviceType: metadata.deviceType,
      os: metadata.os,
      browser: metadata.browser,
      remoteAddress: metadata.remoteAddress,
      viaProxy: metadata.viaProxy,
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
    };
    return this.mutate((sessions) => ({
      next: [...(metadata.kind === 'desktop' ? sessions.filter((existing) => existing.kind !== 'desktop') : sessions), session],
      result: { id: session.id, token },
    }));
  }

  renameSession(sessionId: string, clientName: string): Promise<boolean> {
    return this.mutate((sessions) => {
      const index = sessions.findIndex((session) => session.id === sessionId && session.kind !== 'desktop');
      if (index < 0) return { next: sessions, result: false };
      const next = sessions.slice();
      next[index] = { ...next[index]!, clientName };
      return { next, result: true };
    });
  }

  recordConnection(sessionId: string, connectedAt = new Date().toISOString()): Promise<boolean> {
    return this.mutate((sessions) => {
      const index = sessions.findIndex((session) => session.id === sessionId);
      if (index < 0) return { next: sessions, result: false };
      const next = sessions.slice();
      next[index] = { ...next[index]!, lastConnectedAt: connectedAt };
      return { next, result: true };
    });
  }

  revoke(token: string): Promise<string | null> {
    const candidate = this.digestCredential(token);
    return this.mutate((sessions) => {
      let revokedId: string | null = null;
      const remaining = sessions.filter((session) => {
        const matches = constantTimeEqual(candidate, session.digest);
        if (matches && !revokedId) revokedId = session.id;
        return !matches;
      });
      return { next: revokedId ? remaining : sessions, result: revokedId };
    });
  }

  revokeAll(): Promise<string[]> {
    return this.mutate((sessions) => ({ next: [], result: sessions.map((session) => session.id) }));
  }

  revokeSession(sessionId: string): Promise<boolean> {
    return this.mutate((sessions) => {
      const next = sessions.filter((session) => session.id !== sessionId);
      return { next: next.length === sessions.length ? sessions : next, result: next.length !== sessions.length };
    });
  }

  revokeBrowserSessions(): Promise<string[]> {
    return this.mutate((sessions) => {
      const revoked = sessions.filter((session) => session.kind !== 'desktop').map((session) => session.id);
      return { next: revoked.length ? sessions.filter((session) => session.kind === 'desktop') : sessions, result: revoked };
    });
  }

  listSessions(): StoredSession[] {
    return this.sessions.map((session) => ({
      id: session.id,
      kind: session.kind,
      clientName: session.clientName,
      deviceType: session.deviceType,
      os: session.os,
      browser: session.browser,
      remoteAddress: session.remoteAddress,
      viaProxy: session.viaProxy,
      createdAt: session.createdAt,
      lastConnectedAt: session.lastConnectedAt,
    }));
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.some((session) => session.id === sessionId);
  }

  close(): Promise<void> {
    return this.mutationQueue;
  }

  private mutate<Result>(change: (sessions: PersistedSession[]) => { next: PersistedSession[]; result: Result }): Promise<Result> {
    const operation = this.mutationQueue.then(async () => {
      const { next, result } = change(this.sessions);
      if (next !== this.sessions) {
        await this.writeSessions(next);
        this.sessions = next;
      }
      return result;
    });
    this.mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async writeSessions(sessions: PersistedSession[]): Promise<void> {
    const target = path.join(this.directory, SESSIONS_FILE);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const data: PersistedAuthData = { version: AUTH_DATA_VERSION, sessions };
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      await chmod(target, 0o600);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

async function loadOrCreateSecret(filePath: string): Promise<Buffer> {
  try {
    const encoded = (await readFile(filePath, 'utf8')).trim();
    const secret = Buffer.from(encoded, 'base64url');
    if (secret.byteLength !== SECRET_BYTES || secret.toString('base64url') !== encoded) throw corrupt('server secret');
    await chmod(filePath, 0o600);
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const secret = randomBytes(SECRET_BYTES);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(secret.toString('base64url'), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
    return secret;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function loadSessions(filePath: string): Promise<{ sessions: PersistedSession[]; migrated: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (isLegacyAuthData(parsed)) {
      await chmod(filePath, 0o600);
      return {
        sessions: parsed.sessions.map((session) => ({
          ...session,
          kind: 'legacy',
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

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

async function exists(filePath: string): Promise<boolean> {
  try { await readFile(filePath); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function corrupt(name: string): Error {
  return new Error(`OpenTig authentication ${name} is corrupt.`);
}
