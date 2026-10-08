import type { PublicationContext as Context } from '@shared/repository-access';

export const publicationKey = (id: string) => ['repository', id, 'push-context'] as const;
export function publicationIdentity(context: Context) {
  return JSON.stringify([context.remote, context.urls, context.targetRef, context.mode, context.login]);
}

export function publicationDestination(context: Context): string {
  return context.urls.map(value => {
    try {
      const url = new URL(value);
      const host = url.hostname === 'github.com' ? '' : `${url.hostname}/`;
      return `${host}${url.pathname.replace(/^\//, '').replace(/\.git$/, '')} · ${url.protocol.slice(0, -1).toUpperCase()}`;
    } catch { return value; }
  }).join(', ') || 'No destination';
}

/** UI hint only: the backend remains responsible for credential destination validation. */
export function supportsManagedSetup(urls: string[]): boolean {
  return urls.length === 1 && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/i.test(urls[0] ?? '');
}
