import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { GitHubAccountsStatus } from '../../shared/github-accounts';
import { writeFileAtomically } from './atomicWrite';

const authState = z.enum(['authenticated', 'invalid', 'unknown']);
const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
const schema = z.object({
  installationStatus: z.enum(['unchecked', 'available', 'not-found', 'not-executable', 'incompatible', 'inspection-failed']),
  version: z.string().max(200).optional(),
  accounts: z.array(z.object({ host: z.literal('github.com'), login, active: z.boolean(), state: authState,
    storage: z.enum(['keyring', 'file', 'unknown']), scopes: z.string().max(500).optional() })).max(100),
  activeLogin: login.nullable(),
  environment: z.object({ present: z.boolean(), login: login.nullable(), state: authState }),
  checkedAt: z.string().datetime().nullable(),
  message: z.string().max(500).optional(),
});

/** Allowlisted metadata only. Never persist CLI output or credentials. */
export class GitHubStatusStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async load(): Promise<GitHubAccountsStatus | null> {
    await this.pending;
    try {
      if ((await stat(this.filePath)).size > 256 * 1024) return null;
      const parsed = schema.safeParse(JSON.parse(await readFile(this.filePath, 'utf8')));
      return parsed.success ? parsed.data as GitHubAccountsStatus : null;
    } catch { return null; }
  }

  save(value: GitHubAccountsStatus): Promise<void> {
    const snapshot = JSON.stringify(schema.parse(value));
    const write = this.pending.then(() => writeFileAtomically(this.filePath, snapshot, { parseJson: true }));
    this.pending = write.catch(() => undefined);
    return write;
  }
}
