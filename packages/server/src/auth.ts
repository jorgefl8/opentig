import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { OPEN_TIG_SESSION_COOKIE } from '../../../src/shared/server-protocol';
import { PersistentAuthStore } from './auth-store';
import type { SessionMetadata, StoredSession } from './auth-store';

export { OPEN_TIG_SESSION_COOKIE } from '../../../src/shared/server-protocol';
export const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1_000;

export interface OpenTigAuthDescriptor {
  authenticationRequired: true;
  pairingAvailable: boolean;
}

export interface OpenTigBootstrapAuthSource {
  consumeDesktopSecret(secret: string): Promise<boolean> | boolean;
}

export interface PairingToken {
  token: string;
  expiresAt: string;
}

interface PendingPairing {
  digest: string;
  expiresAt: number;
}

/** Owner sessions plus one memory-only pairing credential. */
export class OpenTigSessionAuth {
  private pairing: PendingPairing | null = null;

  private constructor(
    readonly source: OpenTigBootstrapAuthSource,
    private readonly store: PersistentAuthStore,
    private readonly secureCookies: boolean,
    private readonly now: () => number,
  ) {}

  static async open(options: {
    source: OpenTigBootstrapAuthSource;
    dataDirectory: string;
    secureCookies?: boolean;
    now?: () => number;
  }): Promise<OpenTigSessionAuth> {
    const store = await PersistentAuthStore.open(options.dataDirectory);
    return new OpenTigSessionAuth(options.source, store, options.secureCookies ?? false, options.now ?? Date.now);
  }

  descriptor(): OpenTigAuthDescriptor {
    this.dropExpiredPairing();
    return { authenticationRequired: true, pairingAvailable: this.pairing !== null };
  }

  createPairingToken(ttlMs = DEFAULT_PAIRING_TTL_MS): PairingToken {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60 * 1_000) throw new Error('Invalid pairing token lifetime.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + ttlMs;
    this.pairing = { digest: this.store.digestCredential(token), expiresAt };
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async exchangeDesktopSecret(secret: unknown): Promise<string | null> {
    if (!isCredential(secret) || !await this.source.consumeDesktopSecret(secret)) return null;
    return this.issueCookie({
      kind: 'desktop',
      clientName: 'OpenTig desktop',
      deviceType: 'desktop',
      os: null,
      browser: null,
      remoteAddress: null,
      viaProxy: false,
    });
  }

  async exchangePairingToken(token: unknown, metadata?: Omit<SessionMetadata, 'kind'>, secure = false): Promise<string | null> {
    this.dropExpiredPairing();
    const pairing = this.pairing;
    if (!pairing || !isCredential(token) || !this.store.matchesDigest(token, pairing.digest)) return null;
    this.pairing = null;
    try {
      return await this.issueCookie({
        kind: 'browser',
        clientName: metadata?.clientName ?? 'Browser',
        deviceType: metadata?.deviceType ?? 'unknown',
        os: metadata?.os ?? null,
        browser: metadata?.browser ?? null,
        remoteAddress: metadata?.remoteAddress ?? null,
        viaProxy: metadata?.viaProxy ?? false,
      }, secure);
    } catch (error) {
      if (this.now() < pairing.expiresAt && !this.pairing) this.pairing = pairing;
      throw error;
    }
  }

  authenticate(headers: Pick<IncomingHttpHeaders, 'cookie'>): string | null {
    const token = readCookie(headers.cookie, OPEN_TIG_SESSION_COOKIE);
    return token ? this.store.authenticate(token) : null;
  }

  async revoke(headers: Pick<IncomingHttpHeaders, 'cookie'>): Promise<string | null> {
    const token = readCookie(headers.cookie, OPEN_TIG_SESSION_COOKIE);
    return token ? this.store.revoke(token) : null;
  }

  revokeAll(): Promise<string[]> {
    return this.store.revokeAll();
  }

  sessions(): StoredSession[] {
    return this.store.listSessions();
  }

  async revokeBrowserSession(sessionId: string): Promise<boolean> {
    const session = this.store.listSessions().find((candidate) => candidate.id === sessionId);
    if (!session || session.kind === 'desktop') return false;
    return this.store.revokeSession(sessionId);
  }

  async renameBrowserSession(sessionId: string, clientName: string): Promise<boolean> {
    const session = this.store.listSessions().find((candidate) => candidate.id === sessionId);
    if (!session || session.kind === 'desktop') return false;
    return this.store.renameSession(sessionId, clientName);
  }

  recordConnection(sessionId: string): Promise<boolean> {
    return this.store.recordConnection(sessionId, new Date(this.now()).toISOString());
  }

  revokeBrowserSessions(): Promise<string[]> {
    return this.store.revokeBrowserSessions();
  }

  async revokeAllAndIssueDesktopCookie(): Promise<{ sessionIds: string[]; cookie: string }> {
    const sessionIds = await this.store.revokeAll();
    return {
      sessionIds,
      cookie: await this.issueCookie({
        kind: 'desktop',
        clientName: 'OpenTig desktop',
        deviceType: 'desktop',
        os: null,
        browser: null,
        remoteAddress: null,
        viaProxy: false,
      }),
    };
  }

  hasSession(sessionId: string): boolean {
    return this.store.hasSession(sessionId);
  }

  close(): Promise<void> {
    this.pairing = null;
    return this.store.close();
  }

  expiredCookie(secure = false): string {
    return `${OPEN_TIG_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secureCookies || secure ? '; Secure' : ''}`;
  }

  private async issueCookie(metadata: SessionMetadata, secure = false): Promise<string> {
    const session = await this.store.issue(metadata);
    return `${OPEN_TIG_SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Strict${this.secureCookies || secure ? '; Secure' : ''}`;
  }

  private dropExpiredPairing(): void {
    if (this.pairing && this.now() >= this.pairing.expiresAt) this.pairing = null;
  }
}

/** One-use desktop bootstrap secret supplied by Electron main. */
export class OneTimeBootstrapAuthSource implements OpenTigBootstrapAuthSource {
  private desktopSecret: string | null;

  constructor(options: { desktopSecret: string }) {
    if (!isCredential(options.desktopSecret)) throw new Error('Desktop bootstrap secret is required.');
    this.desktopSecret = options.desktopSecret;
  }

  consumeDesktopSecret(secret: string): boolean {
    if (!this.desktopSecret || !sameSecret(this.desktopSecret, secret)) return false;
    this.desktopSecret = null;
    return true;
  }
}

function sameSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function isCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1_024;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return isCredential(value) ? value : null;
  }
  return null;
}
