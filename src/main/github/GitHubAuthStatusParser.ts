import type { GitHubAccount, GitHubAccountsStatus } from '../../shared/github-accounts';

export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** gh JSON exits zero even when accounts fail authentication. Ignore all token/error fields. */
export function parseGitHubAuthStatus(raw: string): Pick<GitHubAccountsStatus, 'accounts' | 'activeLogin'> {
  const input: unknown = JSON.parse(raw);
  if (!input || typeof input !== 'object' || !('hosts' in input) || !input.hosts || typeof input.hosts !== 'object') throw new Error('Invalid gh status');
  const entries = (input.hosts as Record<string, unknown>)['github.com'] ?? [];
  if (!Array.isArray(entries) || entries.length > 100) throw new Error('Invalid gh accounts');
  const accounts: GitHubAccount[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.login !== 'string' || !GITHUB_LOGIN.test(entry.login)) continue;
    accounts.push({ host: 'github.com', login: entry.login, active: entry.active === true,
      state: entry.state === 'success' ? 'authenticated' : entry.state === 'error' ? 'invalid' : 'unknown',
      storage: entry.tokenSource === 'keyring' ? 'keyring'
        : typeof entry.tokenSource === 'string' && (entry.tokenSource === 'oauth_token' || /(?:^|[/\\])hosts\.yml$/.test(entry.tokenSource)) ? 'file' : 'unknown',
      ...(typeof entry.scopes === 'string' && /^[A-Za-z0-9_:, -]{0,500}$/.test(entry.scopes) ? { scopes: entry.scopes } : {}),
    });
  }
  return { accounts, activeLogin: accounts.find((account) => account.active)?.login ?? null };
}
