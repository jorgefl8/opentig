import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { AiHarnessStatus } from '../../shared/contracts';
import { writeFileAtomically } from './atomicWrite';

// Only public status metadata is persisted; unknown fields such as credentials are discarded.
const statusSchema = z.object({
  id: z.enum(['codex', 'claude', 'opencode', 'grok']), label: z.string(),
  availability: z.enum(['ready', 'warning', 'error']), installed: z.boolean(),
  authStatus: z.enum(['authenticated', 'unauthenticated', 'unknown']),
  installationStatus: z.enum(['available', 'not-found', 'not-executable', 'incompatible', 'inspection-failed']).optional(),
  executablePath: z.string().optional(), executableSource: z.enum(['configured', 'process-path', 'user-path', 'known-location']).optional(),
  discoveryWarning: z.string().optional(), version: z.string().optional(), message: z.string().optional(), cliName: z.string().optional(),
  models: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })),
  checkedAt: z.string().datetime(),
});
const cacheSchema = z.object({
  version: z.literal(1), key: z.string(), statuses: z.array(statusSchema).min(1).max(4),
}).refine(({ statuses }) => new Set(statuses.map((status) => status.id)).size === statuses.length);

/** Optional cache scoped to the backend's existing application-data directory. */
export class AiStatusStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async load(key: string): Promise<AiHarnessStatus[] | null> {
    await this.pending;
    try {
      if ((await stat(this.filePath)).size > 4 * 1024 * 1024) return null;
      const parsed = cacheSchema.safeParse(JSON.parse(await readFile(this.filePath, 'utf8')));
      return parsed.success && parsed.data.key === key ? parsed.data.statuses as AiHarnessStatus[] : null;
    } catch { return null; }
  }

  save(key: string, statuses: AiHarnessStatus[]): Promise<void> {
    const snapshot = cacheSchema.parse({ version: 1, key, statuses });
    const write = this.pending.then(() => writeFileAtomically(this.filePath, JSON.stringify(snapshot), { parseJson: true }));
    this.pending = write.catch(() => undefined);
    return write;
  }
}
