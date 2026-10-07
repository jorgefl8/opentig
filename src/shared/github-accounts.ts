import { z } from 'zod';

export const githubAccountSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }),
  z.object({ mode: z.literal('account'), host: z.literal('github.com'), login: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/) }),
]);
export type GitHubAccountSelection = z.infer<typeof githubAccountSelectionSchema>;
export const AUTOMATIC_GITHUB_ACCOUNT: GitHubAccountSelection = { mode: 'auto' };

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
  login: string | null;
  source: 'explicit' | 'ssh' | 'global' | 'environment' | null;
  state: 'ready' | 'unchecked' | 'error';
  checkedAt: string | null;
  message?: string;
  /** Changes invalidate pending reads in all clients of this backend. */
  revision: number;
}
