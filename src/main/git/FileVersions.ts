import { FILE_VERSION_MAX_BYTES, type FileVersion, type FileVersionsResult } from '../../shared/contracts';
import { OPEN_TIG_MAX_SERVER_MESSAGE_BYTES } from '../../shared/server-protocol';

/**
 * Reads the two versions of a file a diff compares, whole, so the diff can be
 * highlighted in the context of the whole file. Revisions are object ids the
 * caller checked; paths reach Git only after the end of options, as literal
 * pathspecs, and blobs are read by the object id Git listed for them. Nothing
 * is fetched: a blob a partial clone lacks makes the versions unavailable.
 */

export type FileVersionsGit = (args: string[], options: { operation: string; maxOutputBytes: number; timeoutMs: number; stdin?: string }) => Promise<{ stdout: Buffer }>;

/** Where one side of a diff is: a path in a commit's tree, in the index, or in the working tree. */
export type FileVersionSource =
  | { from: 'tree'; rev: string; path: string }
  | { from: 'index'; path: string }
  | { from: 'worktree'; read(maxBytes: number): Promise<Buffer> };

/** Both versions and their blobs, with a margin for the rest of the message, fit in one answer to the client. */
const RESULT_JSON_LIMIT_BYTES = OPEN_TIG_MAX_SERVER_MESSAGE_BYTES - 16 * 1024;
const GIT_TIMEOUT_MS = 15_000;
const OPERATION = 'file-versions';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** Regular files, executable or not. A symbolic link or a submodule is not a file whose text a diff shows. */
const REGULAR_FILE_MODES = new Set(['100644', '100755']);

/** A version that cannot be shown whole; the diff keeps its patch alone. */
export class FileVersionUnavailable extends Error {}

/** What a side resolved to before its content is read. */
type Located = { blob: string } | { worktree: (maxBytes: number) => Promise<Buffer> } | null;

/**
 * Reads both sides within `maxBytes` together and `FILE_VERSION_MAX_BYTES` each. A side that is null, or
 * whose path its tree or index does not have, comes back null.
 */
export async function readFileVersions(git: FileVersionsGit, sides: { old: FileVersionSource | null; new: FileVersionSource | null }, maxBytes: number): Promise<FileVersionsResult> {
  try {
    const [oldSide, newSide] = await Promise.all([locate(git, sides.old), locate(git, sides.new)]);
    const blobs = [oldSide, newSide].flatMap((side) => side && 'blob' in side ? [side.blob] : []);
    const budget = { remaining: Math.min(maxBytes, 2 * FILE_VERSION_MAX_BYTES) };
    const contents = await readBlobs(git, blobs, budget);
    const version = async (side: Located): Promise<FileVersion | null> => {
      if (!side) return null;
      if ('blob' in side) return { content: text(contents.get(side.blob)!), oid: side.blob };
      const limit = Math.min(FILE_VERSION_MAX_BYTES, budget.remaining);
      const buffer = await side.worktree(limit);
      if (buffer.length > limit) throw new FileVersionUnavailable();
      budget.remaining -= buffer.length;
      return { content: text(buffer), oid: null };
    };
    const result: FileVersionsResult = { status: 'ready', old: await version(oldSide), new: await version(newSide) };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > RESULT_JSON_LIMIT_BYTES) return { status: 'unavailable' };
    return result;
  } catch (error) {
    if (error instanceof FileVersionUnavailable) return { status: 'unavailable' };
    throw error;
  }
}

/** The commit's first parent, as the commit viewer compares a commit with; null for a root commit. */
export async function firstParent(git: FileVersionsGit, oid: string): Promise<string | null> {
  if (!OID.test(oid.toLowerCase())) throw new FileVersionUnavailable();
  const output = await git(['rev-list', '--parents', '-n', '1', oid, '--'], { operation: OPERATION, maxOutputBytes: 64 * 1024, timeoutMs: GIT_TIMEOUT_MS });
  const [, parent] = output.stdout.toString('utf8').trim().split(/\s+/);
  if (parent === undefined) return null;
  if (!OID.test(parent)) throw new FileVersionUnavailable();
  return parent;
}

async function locate(git: FileVersionsGit, source: FileVersionSource | null): Promise<Located> {
  if (!source) return null;
  if (source.from === 'worktree') return { worktree: source.read };
  if (source.from === 'tree') {
    if (!OID.test(source.rev.toLowerCase())) throw new FileVersionUnavailable();
    // One record, `<mode> <type> <object>\t<path>`, or none; a directory of that name lists as a tree.
    const output = await git(['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', source.rev, '--', source.path], { operation: OPERATION, maxOutputBytes: 64 * 1024, timeoutMs: GIT_TIMEOUT_MS });
    return entry(output.stdout, source.path, /^(\d{6}) (\w+) ([0-9a-f]+)\t/, (match) => match[2] === 'blob');
  }
  // `<mode> <object> <stage>\t<path>`: a file in conflict has stages 1 to 3, and no single version.
  const output = await git(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', source.path], { operation: OPERATION, maxOutputBytes: 64 * 1024, timeoutMs: GIT_TIMEOUT_MS });
  return entry(output.stdout, source.path, /^(\d{6}) ([0-9a-f]+) (\d)\t/, (match) => match[3] === '0', 2);
}

function entry(stdout: Buffer, path: string, format: RegExp, accept: (match: RegExpExecArray) => boolean, oidGroup = 3): Located {
  for (const record of stdout.toString('utf8').split('\0')) {
    const match = format.exec(record);
    if (!match || record.slice(match[0].length) !== path) continue;
    const oid = match[oidGroup]!;
    if (!accept(match) || !REGULAR_FILE_MODES.has(match[1]!) || !OID.test(oid)) throw new FileVersionUnavailable();
    return { blob: oid };
  }
  return null;
}

/** The blobs' contents, after checking their sizes against the budget, which they then take from. */
async function readBlobs(git: FileVersionsGit, oids: string[], budget: { remaining: number }): Promise<Map<string, Buffer>> {
  const contents = new Map<string, Buffer>();
  if (!oids.length) return contents;
  const unique = [...new Set(oids)];
  const stdin = unique.join('\n') + '\n';
  const check = await git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { operation: OPERATION, maxOutputBytes: 64 * 1024, timeoutMs: GIT_TIMEOUT_MS, stdin });
  const sizes = new Map<string, number>();
  for (const line of check.stdout.toString('utf8').split('\n')) {
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(line.trim());
    if (match) sizes.set(match[1]!, Number(match[2]));
  }
  let total = 0;
  for (const oid of oids) {
    const size = sizes.get(oid);
    if (size === undefined || size > FILE_VERSION_MAX_BYTES) throw new FileVersionUnavailable();
    total += size;
  }
  if (total > budget.remaining) throw new FileVersionUnavailable();
  budget.remaining -= total;
  const expected = unique.reduce((bytes, oid) => bytes + sizes.get(oid)!, 0);
  // Each object comes as `<oid> blob <size>\n<content>\n`.
  const output = (await git(['cat-file', '--batch'], { operation: OPERATION, maxOutputBytes: expected + unique.length * 160, timeoutMs: GIT_TIMEOUT_MS, stdin })).stdout;
  let offset = 0;
  for (const oid of unique) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0 || output.subarray(offset, newline).toString('utf8') !== `${oid} blob ${sizes.get(oid)}`) throw new FileVersionUnavailable();
    const start = newline + 1;
    const end = start + sizes.get(oid)!;
    if (end > output.length) throw new FileVersionUnavailable();
    contents.set(oid, output.subarray(start, end));
    offset = end + 1;
  }
  return contents;
}

/** Text as the diff reads it. A NUL byte marks a file Git would not show as text. */
function text(buffer: Buffer): string {
  if (buffer.includes(0)) throw new FileVersionUnavailable();
  return buffer.toString('utf8');
}
