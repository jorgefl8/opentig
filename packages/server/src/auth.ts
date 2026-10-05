import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { applicationName, sessionCookieName, type ApplicationProfile } from '../../../src/shared/application-profile';
import { BROWSER_SESSION_MAX_AGE_SECONDS, PersistentAuthStore } from './auth-store';
import type { SessionMetadata, StoredSession } from './auth-store';

export { OPEN_TIG_SESSION_COOKIE } from '../../../src/shared/server-protocol';
export const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1_000;
export { BROWSER_SESSION_MAX_AGE_SECONDS } from './auth-store';

export interface OpenTigAuthDescriptor {
  authenticationRequired: true;
  pairingAvailable: boolean;
  browserAccessEnabled: boolean;
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
  private browserAccessEnabled: boolean;
  private browserGeneration = 0;
  private browserQueue: Promise<void> = Promise.resolve();

  private constructor(
    readonly source: OpenTigBootstrapAuthSource,
    private readonly store: PersistentAuthStore,
    private readonly secureCookies: boolean,
    private readonly now: () => number,
    private readonly profile: ApplicationProfile,
    browserAccessEnabled: boolean,
  ) { this.browserAccessEnabled = browserAccessEnabled; }

  static async open(options: {
    source: OpenTigBootstrapAuthSource;
    dataDirectory: string;
    secureCookies?: boolean;
    now?: () => number;
    profile?: ApplicationProfile;
    browserAccessEnabled?: boolean;
  }): Promise<OpenTigSessionAuth> {
    const store = await PersistentAuthStore.open(options.dataDirectory, options.now);
    const auth = new OpenTigSessionAuth(options.source, store, options.secureCookies ?? false, options.now ?? Date.now, options.profile ?? 'production', options.browserAccessEnabled ?? true);
    if (!auth.browserAccessEnabled) await store.revokeBrowserSessions();
    return auth;
  }

  descriptor(): OpenTigAuthDescriptor {
    this.dropExpiredPairing();
    return { authenticationRequired: true, pairingAvailable: this.browserAccessEnabled && this.pairing !== null, browserAccessEnabled: this.browserAccessEnabled };
  }

  setBrowserAccessEnabled(enabled: boolean): Promise<string[]> {
    if (!enabled) {
      this.browserAccessEnabled = false;
      this.browserGeneration++;
      this.pairing = null;
    }
    const generation = this.browserGeneration;
    return this.queueBrowserMutation(async () => {
      // Retrying enable must also clean up after a failed disable/revocation.
      const revoked = !this.browserAccessEnabled ? await this.store.revokeBrowserSessions() : [];
      this.browserAccessEnabled = enabled && generation === this.browserGeneration;
      return revoked;
    });
  }

  createPairingToken(ttlMs = DEFAULT_PAIRING_TTL_MS): PairingToken {
    if (!this.browserAccessEnabled) throw new Error('Web access is disabled.');
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
      clientName: `${applicationName(this.profile)} desktop`,
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
    if (!this.browserAccessEnabled || !pairing || !isCredential(token) || !this.store.matchesDigest(token, pairing.digest)) return null;
    this.pairing = null;
    const generation = this.browserGeneration;
    return this.queueBrowserMutation(async () => {
      if (!this.browserAccessEnabled || generation !== this.browserGeneration) return null;
      try {
        const cookie = await this.issueCookie({
        kind: 'browser',
        clientName: metadata?.clientName ?? 'Browser',
        deviceType: metadata?.deviceType ?? 'unknown',
        os: metadata?.os ?? null,
        browser: metadata?.browser ?? null,
        remoteAddress: metadata?.remoteAddress ?? null,
        viaProxy: metadata?.viaProxy ?? false,
        }, secure);
        if (!this.browserAccessEnabled || generation !== this.browserGeneration) {
          await this.revoke({ cookie });
          return null;
        }
        return cookie;
      } catch (error) {
        if (this.browserAccessEnabled && generation === this.browserGeneration && this.now() < pairing.expiresAt && !this.pairing) this.pairing = pairing;
        throw error;
      }
    });
  }

  authenticate(headers: Pick<IncomingHttpHeaders, 'cookie'>): string | null {
    const token = readCookie(headers.cookie, sessionCookieName(this.profile));
    const sessionId = token ? this.store.authenticate(token) : null;
    return sessionId && this.hasSession(sessionId) ? sessionId : null;
  }

  async renewBrowserCookie(headers: Pick<IncomingHttpHeaders, 'cookie'>, secure = false): Promise<string | null> {
    if (!this.browserAccessEnabled) return null;
    const generation = this.browserGeneration;
    const token = readCookie(headers.cookie, sessionCookieName(this.profile));
    if (!token || !await this.store.renewBrowserSession(token)) return null;
    if (!this.browserAccessEnabled || generation !== this.browserGeneration) return null;
    return this.sessionCookie(token, true, secure);
  }

  async revoke(headers: Pick<IncomingHttpHeaders, 'cookie'>): Promise<string | null> {
    const token = readCookie(headers.cookie, sessionCookieName(this.profile));
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
        clientName: `${applicationName(this.profile)} desktop`,
        deviceType: 'desktop',
        os: null,
        browser: null,
        remoteAddress: null,
        viaProxy: false,
      }),
    };
  }

  hasSession(sessionId: string): boolean {
    return this.store.hasSession(sessionId) && (this.browserAccessEnabled || this.sessions().some((session) => session.id === sessionId && session.kind === 'desktop'));
  }

  close(): Promise<void> {
    this.browserAccessEnabled = false;
    this.browserGeneration++;
    this.pairing = null;
    return this.browserQueue.then(() => this.store.close());
  }

  private queueBrowserMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.browserQueue.then(operation);
    this.browserQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  expiredCookie(secure = false): string {
    return `${sessionCookieName(this.profile)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secureCookies || secure ? '; Secure' : ''}`;
  }

  private async issueCookie(metadata: SessionMetadata, secure = false): Promise<string> {
    const session = await this.store.issue(metadata);
    return this.sessionCookie(session.token, metadata.kind === 'browser', secure);
  }

  private sessionCookie(token: string, persistent: boolean, secure: boolean): string {
    const lifetime = persistent ? `; Max-Age=${BROWSER_SESSION_MAX_AGE_SECONDS}` : '';
    return `${sessionCookieName(this.profile)}=${token}; Path=/; HttpOnly; SameSite=Strict${lifetime}${this.secureCookies || secure ? '; Secure' : ''}`;
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
