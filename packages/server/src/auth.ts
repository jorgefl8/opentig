import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const OPEN_TIG_SESSION_COOKIE = 'opentig_session';

export interface OpenTigAuthDescriptor {
  authenticationRequired: true;
  pairingAvailable: boolean;
}

export interface OpenTigBootstrapAuthSource {
  descriptor(): OpenTigAuthDescriptor;
  consumeDesktopSecret(secret: string): Promise<boolean> | boolean;
  consumePairingToken(token: string): Promise<boolean> | boolean;
}

interface SessionRecord {
  id: string;
  digest: string;
}

/** In-memory owner sessions. Durable hashed storage is introduced in Step 3. */
export class OpenTigSessionAuth {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    readonly source: OpenTigBootstrapAuthSource,
    private readonly secureCookies = false,
  ) {}

  descriptor(): OpenTigAuthDescriptor {
    return this.source.descriptor();
  }

  async exchangeDesktopSecret(secret: unknown): Promise<string | null> {
    if (!isCredential(secret) || !await this.source.consumeDesktopSecret(secret)) return null;
    return this.issueCookie();
  }

  async exchangePairingToken(token: unknown): Promise<string | null> {
    if (!isCredential(token) || !await this.source.consumePairingToken(token)) return null;
    return this.issueCookie();
  }

  authenticate(headers: Pick<IncomingHttpHeaders, 'cookie'>): string | null {
    const token = readCookie(headers.cookie, OPEN_TIG_SESSION_COOKIE);
    if (!token) return null;
    return this.sessions.get(digest(token))?.id ?? null;
  }

  revoke(headers: Pick<IncomingHttpHeaders, 'cookie'>): string | null {
    const token = readCookie(headers.cookie, OPEN_TIG_SESSION_COOKIE);
    if (!token) return null;
    const key = digest(token);
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    return session?.id ?? null;
  }

  hasSession(sessionId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.id === sessionId) return true;
    }
    return false;
  }

  clear(): void {
    this.sessions.clear();
  }

  expiredCookie(): string {
    return `${OPEN_TIG_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secureCookies ? '; Secure' : ''}`;
  }

  private issueCookie(): string {
    const token = randomBytes(32).toString('base64url');
    const key = digest(token);
    this.sessions.set(key, { id: randomBytes(18).toString('base64url'), digest: key });
    return `${OPEN_TIG_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${this.secureCookies ? '; Secure' : ''}`;
  }
}

/** One-use bootstrap source suitable for desktop startup and focused tests. */
export class OneTimeBootstrapAuthSource implements OpenTigBootstrapAuthSource {
  private desktopSecret: string | null;
  private readonly pairingTokens: string[];

  constructor(options: { desktopSecret: string; pairingTokens?: string[] }) {
    if (!isCredential(options.desktopSecret)) throw new Error('Desktop bootstrap secret is required.');
    this.desktopSecret = options.desktopSecret;
    this.pairingTokens = [...(options.pairingTokens ?? [])];
  }

  descriptor(): OpenTigAuthDescriptor {
    return { authenticationRequired: true, pairingAvailable: this.pairingTokens.length > 0 };
  }

  consumeDesktopSecret(secret: string): boolean {
    if (!this.desktopSecret || !sameSecret(this.desktopSecret, secret)) return false;
    this.desktopSecret = null;
    return true;
  }

  consumePairingToken(token: string): boolean {
    const index = this.pairingTokens.findIndex((candidate) => sameSecret(candidate, token));
    if (index < 0) return false;
    this.pairingTokens.splice(index, 1);
    return true;
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
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
