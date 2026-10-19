import type { PublicationContext as Context } from '@shared/repository-access';

export const publicationKey = (id: string) => ['repository', id, 'push-context'] as const;
export function publicationDestination(context: Context): string {
  return context.urls.map(value => {
    try {
      const url = new URL(value);
      const host = url.hostname === 'github.com' ? '' : `${url.hostname}/`;
      return `${host}${url.pathname.replace(/^\//, '').replace(/\.git$/, '')} · ${url.protocol.slice(0, -1).toUpperCase()}`;
    } catch {
      const ssh = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value);
      return ssh ? `${ssh[1] === 'github.com' ? '' : `${ssh[1]}/`}${ssh[2]!.replace(/\.git$/, '')} · SSH` : value;
    }
  }).join(', ') || 'No destination';
}
