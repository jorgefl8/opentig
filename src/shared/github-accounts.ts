import { z } from 'zod';

export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/**
 * Which credentials a repository uses. `default` follows the OpenTig default
 * account; `account` pins one connected account (`detected` when OpenTig chose
 * it because the default had no access); `git` keeps Git's own credentials.
 */
export const githubAccountSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('account'), host: z.literal('github.com'), login: z.string().regex(GITHUB_LOGIN_PATTERN), detected: z.boolean().optional() }),
  z.object({ mode: z.literal('git') }),
]);
export type GitHubAccountSelection = z.infer<typeof githubAccountSelectionSchema>;
export const DEFAULT_GITHUB_ACCOUNT: GitHubAccountSelection = { mode: 'default' };

/** Where the account a repository uses comes from. */
export type GitHubAccountSource = 'repository' | 'detected' | 'default' | 'git';

/** The account a selection uses; without a default account, `default` falls back to Git's own credentials. */
export function resolveGitHubAccount(selection: GitHubAccountSelection, defaultLogin: string | null): { login: string | null; source: GitHubAccountSource } {
  if (selection.mode === 'account') return { login: selection.login, source: selection.detected ? 'detected' : 'repository' };
  if (selection.mode === 'default' && defaultLogin) return { login: defaultLogin, source: 'default' };
  return { login: null, source: 'git' };
}

/**
 * Reads a saved selection, including earlier formats: `auto` and selections
 * linked to the shared default now follow the default account, and the former
 * per-repository Git mode no longer exists because one account serves both.
 */
export function parseStoredGitHubAccount(value: unknown): GitHubAccountSelection | null {
  if (!value || typeof value !== 'object') return null;
  const legacy = value as { mode?: unknown; useGlobalDefault?: unknown };
  if (legacy.mode === 'auto' || (legacy.mode === 'account' && legacy.useGlobalDefault === true)) return DEFAULT_GITHUB_ACCOUNT;
  // Unknown fields, including the former Git mode, are dropped by the schema.
  const parsed = githubAccountSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Git common directories identify repositories across their worktrees. */
export function githubRepositoryKey(commonDir: string, platform = process.platform): string {
  const key = commonDir.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? key.toLowerCase() : key;
}

export interface GitHubAccount {
  host: 'github.com';
  login: string;
  active: boolean;
  state: 'authenticated' | 'invalid' | 'unknown';
  storage: 'keyring' | 'file' | 'unknown';
  scopes?: string;
}

export interface GitHubAccountsStatus {
  /** OpenTig default for repositories without their own account; independent of the active gh account. */
  defaultLogin?: string | null;
  repositoryAccounts?: Array<{ repositoryId: string; name: string; login: string | null; source: GitHubAccountSource }>;
  installationStatus: 'unchecked' | 'available' | 'not-found' | 'not-executable' | 'incompatible' | 'inspection-failed';
  version?: string;
  accounts: GitHubAccount[];
  activeLogin: string | null;
  environment: { present: boolean; login: string | null; state: 'authenticated' | 'invalid' | 'unknown' };
  checkedAt: string | null;
  message?: string;
}

export interface GitHubRepositoryAccount {
  selection: GitHubAccountSelection;
  nameWithOwner: string | null;
  /** The account OpenTig uses for this repository, or the verified identity of Git's own credentials. */
  login: string | null;
  /** How the account was chosen; `ssh`/`global`/`environment` describe Git's own credentials. */
  source: GitHubAccountSource | 'ssh' | 'global' | 'environment' | null;
  state: 'ready' | 'unchecked' | 'error';
  checkedAt: string | null;
  message?: string;
  /** Changes invalidate pending reads in all clients of this backend. */
  revision: number;
  access?: import('./repository-access').RepositoryAccess;
}
