import type { AccessCheck, RepositoryAccess } from '@shared/repository-access';
import { formatDateTime } from '@shared/date-format';
import { publicationDestination } from '@/features/refs/publication-context';

export const accessStateLabels: Record<AccessCheck['state'], string> = {
  unchecked: 'Not checked', ok: 'Verified', expired: 'Reconnect account', inaccessible: 'No access',
  offline: 'Offline', external: 'This machine', stale: 'Check again',
};

export function gitHttpsAccountLabel(login: string | null): string {
  return login ? `@${login}` : 'This account';
}

export function gitHttpsModeLabel(mode: 'managed' | 'external', login: string | null): string {
  return mode === 'managed' && login ? `@${login}` : 'This machine';
}

export function gitHttpsOutcome(input: { auto: boolean; managed: boolean; login: string | null }): string {
  if (input.auto) return 'Choose an account above to use it for GitHub HTTPS fetch and push.';
  if (input.managed && input.login) return `PRs and Git HTTPS both use @${input.login}.`;
  if (input.login) return `PRs as @${input.login}. Git HTTPS uses this machine.`;
  return 'Git HTTPS uses this machine.';
}

export function lastGitOperationLabel(operation: { operation: string; ok: boolean; login: string | null; at: string; url: string; message?: string }): string {
  const who = operation.login ? `@${operation.login}` : 'This machine';
  return `${operation.operation} · ${operation.ok ? 'Succeeded' : 'Failed'} · ${who} · ${formatDateTime(operation.at, { seconds: true })}`;
}

export function repositoryAccessDebugText(access: RepositoryAccess): string {
  const checks = [['Account', access.identity], ['GitHub / PRs', access.api], ['Git read', access.read], ['Write permission', access.write]] as const;
  const lines = [
    access.checkedAt ? `Last checked: ${formatDateTime(access.checkedAt, { seconds: true })}` : 'Access has not been checked.',
    `Push destination: ${publicationDestination(access.publication)}`,
    `Push URL: ${access.publication.urls.join(', ') || 'None'}`,
    ...checks.map(([label, check]) => `${label}: ${check.state === 'ok' && label === 'Write permission' ? 'Declared by GitHub' : accessStateLabels[check.state]}${check.message ? ` — ${check.message}` : ''}`),
    `Git HTTPS: ${gitHttpsModeLabel(access.publication.mode, access.publication.login)}`,
  ];
  if (access.lastOperation) {
    lines.push(`Last Git: ${lastGitOperationLabel(access.lastOperation)}`);
    lines.push(access.lastOperation.url);
    if (access.lastOperation.message) lines.push(access.lastOperation.message);
  }
  lines.push('Write permission is declared by GitHub. Branch policies can still reject a push.');
  return lines.join('\n');
}
