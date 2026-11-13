import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GitOperationError } from '../../shared/errors';
import { LINE_BLAME_MAX_BYTES, type LineBlameCommit, type LineBlameLine, type LineBlameResult } from '../../shared/line-blame';
import type { GitProcess } from './GitProcess';
import type { RepositoryService } from './RepositoryService';

const HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: \d+)?$/;
const CACHE_ENTRIES = 24;
const BLAME_TIMEOUT_MS = 25_000;

/**
 * Parses `git blame --porcelain`. Git prints a commit's author and summary only
 * the first time it appears, so later groups refer back to it by oid.
 */
export function parseBlamePorcelain(output: string): { commits: LineBlameCommit[]; lines: LineBlameLine[] } {
  const commits: LineBlameCommit[] = [];
  const indexes = new Map<string, number>();
  const lines: LineBlameLine[] = [];
  let current: { commit: LineBlameCommit; originalLine: number; finalLine: number } | null = null;
  for (const line of output.split('\n')) {
    if (current) {
      if (line.startsWith('\t')) {
        lines[current.finalLine - 1] = { commit: indexes.get(current.commit.oid)!, originalLine: current.originalLine };
        current = null;
        continue;
      }
      const space = line.indexOf(' ');
      const key = space < 0 ? line : line.slice(0, space);
      const value = space < 0 ? '' : line.slice(space + 1);
      if (key === 'author') current.commit.authorName = value;
      else if (key === 'author-mail') current.commit.authorEmail = value.replace(/^<|>$/g, '');
      else if (key === 'author-time') current.commit.authoredAt = isoFromSeconds(value);
      else if (key === 'summary') current.commit.summary = value;
      continue;
    }
    const header = HEADER.exec(line);
    if (!header) continue;
    const oid = header[1]!;
    let index = indexes.get(oid);
    if (index === undefined) {
      index = commits.push({ oid, uncommitted: /^0+$/.test(oid), authorName: '', authorEmail: '', authoredAt: '', summary: '' }) - 1;
      indexes.set(oid, index);
    }
    current = { commit: commits[index]!, originalLine: Number(header[2]), finalLine: Number(header[3]) };
  }
  // Git reports every line exactly once; fill any hole defensively so the
  // renderer never reads a missing entry.
  return { commits, lines: Array.from(lines, (line) => line ?? { commit: 0, originalLine: 0 }) };
}

function isoFromSeconds(value: string): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : '';
}

/**
 * Reads who last changed each line of a working-tree file, or of an unsaved
 * draft of it. Results are cached by worktree, path, HEAD and the exact text, so
 * hovering lines and reopening a file never spawn Git again until one changes.
 */
export class LineBlameReader {
  private readonly cache = new Map<string, LineBlameResult>();

  constructor(
    private readonly git: GitProcess,
    private readonly repositories: RepositoryService,
  ) {}

  async read(repositoryId: string, filePath: string, draft?: string): Promise<LineBlameResult> {
    const repository = this.repositories.get(repositoryId);
    const [relativePath] = this.repositories.validatePaths(repositoryId, [filePath]);
    const contents = draft === undefined
      ? await readFile(this.repositories.resolvePath(repositoryId, relativePath!))
      : Buffer.from(draft, 'utf8');
    if (contents.byteLength > LINE_BLAME_MAX_BYTES) return { status: 'too-large', limitBytes: LINE_BLAME_MAX_BYTES };
    if (contents.subarray(0, 8000).includes(0)) return { status: 'binary' };

    const head = (await this.git.run(repository.path, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
      operation: 'line-blame', readOnly: true, maxOutputBytes: 1024,
    }).catch(() => null))?.stdout.toString('utf8').trim();
    if (!head) return { status: 'untracked' };

    const key = createHash('sha256').update(JSON.stringify([repository.path, relativePath, head])).update(contents).digest('hex');
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const result = await this.blame(repository.path, relativePath!, head, contents);
    this.cache.set(key, result);
    while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  private async blame(cwd: string, relativePath: string, head: string, contents: Buffer): Promise<LineBlameResult> {
    // Only files HEAD knows have a history; a staged new file would fail blame.
    const tracked = await this.git.run(cwd, ['--literal-pathspecs', 'ls-tree', '-z', '--name-only', head, '--', relativePath], {
      operation: 'line-blame', readOnly: true, maxOutputBytes: 64 * 1024,
    });
    if (tracked.stdout.length === 0) return { status: 'untracked' };
    // Always blame the exact text that was hashed, from stdin: either the saved
    // file or the editor's unsaved draft. Git maps edited lines onto HEAD itself.
    try {
      const output = await this.git.run(cwd, ['blame', '--porcelain', '--contents', '-', head, '--', relativePath], {
        operation: 'line-blame',
        readOnly: true,
        stdin: contents,
        timeoutMs: BLAME_TIMEOUT_MS,
        maxOutputBytes: 32 * 1024 * 1024,
      });
      return { status: 'ready', ...parseBlamePorcelain(output.stdout.toString('utf8')) };
    } catch (error) {
      if (error instanceof GitOperationError && /no such path/i.test(error.detail.stderr ?? error.message)) return { status: 'untracked' };
      throw error;
    }
  }
}
