import type { OpenTigOwnerSession } from '@shared/server-protocol';

export async function loadOwnerSessions(): Promise<OpenTigOwnerSession[]> {
  const response = await fetch('/api/auth/sessions', { credentials: 'include' });
  if (!response.ok) throw new Error(await responseError(response, 'Could not load owner sessions.'));
  const value = await response.json() as { sessions?: unknown };
  if (!Array.isArray(value.sessions)) throw new Error('OpenTig returned an invalid session list.');
  return value.sessions as OpenTigOwnerSession[];
}

export async function revokeOwnerSession(sessionId: string): Promise<number> {
  return revoke('/api/auth/sessions/revoke', { sessionId });
}

export async function revokeAllBrowserSessions(): Promise<number> {
  return revoke('/api/auth/sessions/revoke-all', {});
}

async function revoke(url: string, body: Record<string, unknown>): Promise<number> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await responseError(response, 'Could not revoke the browser session.'));
  const value = await response.json() as { revokedCount?: unknown };
  if (!Number.isSafeInteger(value.revokedCount) || Number(value.revokedCount) < 0) {
    throw new Error('OpenTig returned an invalid revocation result.');
  }
  return Number(value.revokedCount);
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const value = await response.json() as { error?: unknown };
    return typeof value.error === 'string' ? value.error : fallback;
  } catch { return fallback; }
}
