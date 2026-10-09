import type { AccessCheck, RepositoryAccess } from '@shared/repository-access';
import { formatDateTime } from '@shared/date-format';
import { publicationDestination } from '@/features/refs/publication-context';

export const accessStateLabels: Record<AccessCheck['state'], string> = {
  unchecked: 'Not checked', ok: 'Verified', expired: 'Reconnect account', inaccessible: 'No access',
  offline: 'Offline', external: 'Not checked', stale: 'Check again',
};

export function gitHttpsAccountLabel(login: string | null): string {
  return login ? `@${login}` : 'this account';
}

export function gitHttpsModeLabel(mode: 'managed' | 'external', login: string | null): string {
  return mode === 'managed' && login ? `@${login}` : 'Git credentials · account unverified';
}

export function gitCredentialsLocation(): string {
  return window.opentigDesktop ? 'this computer' : 'the server';
}

export function gitHttpsOutcome(input: { managed: boolean; login: string | null; compatible?: boolean }): string {
  if (input.managed && input.login) return `PRs and Git HTTPS both use @${input.login}.`;
  if (input.compatible === false) return `This destination uses Git credentials or SSH keys on ${gitCredentialsLocation()}. The Git account is not verified by OpenTig.`;
  return `Git uses credentials configured on ${gitCredentialsLocation()}. They may belong to a different account from the one selected for GitHub and pull requests.`;
}

export function lastGitOperationLabel(operation: { operation: string; ok: boolean; login: string | null; at: string; url: string; message?: string }): string {
  const who = operation.login ? `@${operation.login}` : 'Git credentials · account unverified';
  return `${operation.operation} · ${operation.ok ? 'Succeeded' : 'Failed'} · ${who} · ${formatDateTime(operation.at, { seconds: true })}`;
}

export function repositoryAccessDebugText(access: RepositoryAccess, accountLogin?: string | null): string {
  const checks = [['Account', access.identity], ['GitHub / PRs', access.api], ['Git read', access.read], ['Write permission', access.write]] as const;
  const lines = [
    access.checkedAt ? `Last checked: ${formatDateTime(access.checkedAt, { seconds: true })}` : 'Access has not been checked.',
    `Push destination: ${publicationDestination(access.publication)}`,
    `Push URL: ${access.publication.urls.join(', ') || 'None'}`,
    `GitHub / PRs account: ${accountLogin ? `@${accountLogin}` : 'Not verified'}`,
    ...checks.map(([label, check]) => `${label}${label === 'Write permission' && accountLogin ? ` (@${accountLogin})` : ''}: ${check.state === 'ok' && label === 'Write permission' ? 'Declared by GitHub' : accessStateLabels[check.state]}${check.message ? ` — ${check.message}` : ''}`),
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
