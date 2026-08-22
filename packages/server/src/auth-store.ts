import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const AUTH_DATA_VERSION = 1;
const SECRET_BYTES = 32;
const SECRET_FILE = 'server-secret';
const SESSIONS_FILE = 'sessions.json';

interface PersistedSession {
  id: string;
  digest: string;
  createdAt: string;
}

interface PersistedAuthData {
  version: typeof AUTH_DATA_VERSION;
  sessions: PersistedSession[];
}

export interface IssuedSession {
  id: string;
  token: string;
}

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
    const sessions = await loadSessions(dataPath);
    const store = new PersistentAuthStore(resolved, secret, sessions);
    if (!(await exists(dataPath))) await store.writeSessions([]);
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

  issue(): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const session: PersistedSession = {
      id: randomBytes(18).toString('base64url'),
      digest: this.digestCredential(token),
      createdAt: new Date().toISOString(),
    };
    return this.mutate((sessions) => ({
      next: [...sessions, session],
      result: { id: session.id, token },
    }));
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

async function loadSessions(filePath: string): Promise<PersistedSession[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!isAuthData(parsed)) throw corrupt('session data');
    await chmod(filePath, 0o600);
    return parsed.sessions.map((session) => ({ ...session }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
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
