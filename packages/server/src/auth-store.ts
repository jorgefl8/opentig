import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { AUTH_DATA_VERSION, hasActiveBrowserSessions, loadSessions, sessionExpiry } from '../../../src/main/persistence/BrowserSessionFile';
import type { PersistedAuthData, PersistedSession } from '../../../src/main/persistence/BrowserSessionFile';

export { BROWSER_SESSION_MAX_AGE_SECONDS } from '../../../src/main/persistence/BrowserSessionFile';
const SECRET_BYTES = 32;
const SECRET_FILE = 'server-secret';
const SESSIONS_FILE = 'sessions.json';

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
    private readonly now: () => number,
  ) {
    this.sessions = sessions;
  }

  /** Inspect an existing installation without issuing, revoking, or writing sessions. */
  static async hasActiveBrowserSessions(directory: string, now: () => number = Date.now): Promise<boolean> {
    return hasActiveBrowserSessions(directory, now);
  }

  static async open(directory: string, now: () => number = Date.now): Promise<PersistentAuthStore> {
    const resolved = path.resolve(directory);
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    await chmod(resolved, 0o700);
    const secret = await loadOrCreateSecret(path.join(resolved, SECRET_FILE));
    const dataPath = path.join(resolved, SESSIONS_FILE);
    const { sessions, migrated } = await loadSessions(dataPath);
    const store = new PersistentAuthStore(resolved, secret, sessions, now);
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
      if (constantTimeEqual(candidate, session.digest) && this.isActive(session)) sessionId ??= session.id;
    }
    return sessionId;
  }

  issue(metadata: SessionMetadata): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const createdAt = new Date(this.now()).toISOString();
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
      createdAt,
      expiresAt: sessionExpiry(metadata.kind, createdAt),
      lastConnectedAt: null,
    };
    return this.mutate((sessions) => ({
      next: [...(metadata.kind === 'desktop' ? sessions.filter((existing) => existing.kind !== 'desktop') : sessions), session],
      result: { id: session.id, token },
    }));
  }

  renameSession(sessionId: string, clientName: string): Promise<boolean> {
    return this.mutate((sessions) => {
      const index = sessions.findIndex((session) => session.id === sessionId && session.kind !== 'desktop' && this.isActive(session));
      if (index < 0) return { next: sessions, result: false };
      const next = sessions.slice();
      next[index] = { ...next[index]!, clientName };
      return { next, result: true };
    });
  }

  renewBrowserSession(token: string): Promise<boolean> {
    const digest = this.digestCredential(token);
    return this.mutate((sessions) => {
      const index = sessions.findIndex((session) => session.kind !== 'desktop'
        && constantTimeEqual(digest, session.digest) && this.isActive(session));
      if (index < 0) return { next: sessions, result: false };
      const session = sessions[index]!;
      const expiresAt = sessionExpiry(session.kind, new Date(this.now()).toISOString());
      if (expiresAt === session.expiresAt) return { next: sessions, result: true };
      const next = sessions.slice();
      next[index] = { ...session, expiresAt };
      return { next, result: true };
    });
  }

  recordConnection(sessionId: string, connectedAt = new Date().toISOString()): Promise<boolean> {
    return this.mutate((sessions) => {
      const index = sessions.findIndex((session) => session.id === sessionId && this.isActive(session));
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
    return this.sessions.filter((session) => this.isActive(session)).map((session) => ({
      id: session.id,
      kind: session.kind,
      clientName: session.clientName,
      deviceType: session.deviceType,
      os: session.os,
      browser: session.browser,
      remoteAddress: session.remoteAddress,
      viaProxy: session.viaProxy,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastConnectedAt: session.lastConnectedAt,
    }));
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.some((session) => session.id === sessionId && this.isActive(session));
  }

  private isActive(session: PersistedSession): boolean {
    return session.expiresAt === null || this.now() < Date.parse(session.expiresAt);
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
