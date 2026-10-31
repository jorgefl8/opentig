import type { DiffResult, PullRequestCommit } from '../../shared/contracts';
import { GitOperationError } from '../../shared/errors';
import { PULL_REQUEST_DIFF_GIT_TIMEOUT_MS, PULL_REQUEST_FETCH_TIMEOUT_MS } from '../../shared/operation-timeouts';
import { OPEN_TIG_MAX_SERVER_MESSAGE_BYTES } from '../../shared/server-protocol';
import type { GitProcess } from '../git/GitProcess';

const OID = /^[0-9a-f]{40,64}$/i;
const PATCH_LIMIT_BYTES = 32 * 1024 * 1024;
/** A patch reaches the client in one WebSocket message, with room for the rest of that message. */
const PATCH_JSON_LIMIT_BYTES = OPEN_TIG_MAX_SERVER_MESSAGE_BYTES - 16 * 1024;
const DIFF = ['--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];

export interface PullRequestRange {
  number: number;
  baseOid: string;
  headOid: string;
}

/**
 * Reads pull request changes from the local clone. GitHub's diff endpoints stop
 * at 300 files and download the whole patch on every view; Git has neither
 * limit once the PR's commits are present locally.
 */
export class PullRequestLocalGit {
  constructor(private readonly git: GitProcess) {}

  /** Downloads the PR head (and the base commit when missing) without creating or moving any ref. */
  async ensureRange(cwd: string, remote: string, range: PullRequestRange, onFetchFailure?: (message: string) => void): Promise<boolean> {
    if (!OID.test(range.baseOid) || !OID.test(range.headOid)) return false;
    if (!(await this.missing(cwd, [range.baseOid, range.headOid])).length) return true;
    // No destination: objects only. Neither FETCH_HEAD nor remote-tracking refs
    // change, so the repository's refs and the user's view stay exactly as they were.
    const fetch = (refspecs: string[]) => this.git.run(cwd, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', remote, ...refspecs], {
      operation: 'pr-local-fetch', timeoutMs: PULL_REQUEST_FETCH_TIMEOUT_MS, maxOutputBytes: 1024 * 1024,
    });
    try {
      if (await this.missing(cwd, [range.headOid]).then(list => list.length > 0)) await fetch([`refs/pull/${range.number}/head`]);
      // A force-pushed or deleted base can leave the recorded base outside the
      // fetched history. GitHub serves reachable commits by object id.
      if ((await this.missing(cwd, [range.baseOid])).length) await fetch([range.baseOid]);
    } catch (error) {
      if (error instanceof GitOperationError) {
        onFetchFailure?.(error.message);
        return false;
      }
      throw error;
    }
    return !(await this.missing(cwd, [range.baseOid, range.headOid])).length;
  }

  /** The same three-dot comparison GitHub shows in "Files changed". */
  async rangeDiff(cwd: string, range: PullRequestRange): Promise<DiffResult> {
    const output = await this.git.run(cwd, ['diff', ...DIFF, `${range.baseOid}...${range.headOid}`, '--'], {
      operation: 'pr-local-diff', readOnly: true, timeoutMs: PULL_REQUEST_DIFF_GIT_TIMEOUT_MS, maxOutputBytes: PATCH_LIMIT_BYTES, truncateOverflow: true,
    });
    return diffResult(`pull/${range.number}`, output.stdout.toString('utf8'), output.truncated === true);
  }

  /** A single commit against its first parent, matching the history viewer. Null when it is not available locally. */
  async commitDiff(cwd: string, oid: string): Promise<DiffResult | null> {
    if (!OID.test(oid) || (await this.missing(cwd, [oid])).length) return null;
    const output = await this.git.run(cwd, ['show', '--format=', ...DIFF, '--diff-merges=first-parent', '--patch', oid, '--'], {
      operation: 'pr-local-commit-diff', readOnly: true, timeoutMs: 60_000, maxOutputBytes: PATCH_LIMIT_BYTES, truncateOverflow: true,
    });
    return diffResult(`commit/${oid}`, output.stdout.toString('utf8'), output.truncated === true);
  }

  /** Every commit in the PR, oldest first, like GitHub's commit list. */
  async commits(cwd: string, range: PullRequestRange): Promise<PullRequestCommit[]> {
    const output = await this.git.run(cwd, ['log', '-z', '--reverse', '--no-color', '--format=%H%x1f%s%x1f%aI%x1f%an', `${range.baseOid}..${range.headOid}`, '--'], {
      operation: 'pr-local-commits', readOnly: true, timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024,
    });
    return output.stdout.toString('utf8').split('\0').filter(Boolean).map(record => {
      const [oid = '', messageHeadline = '', authoredAt = '', author = ''] = record.replace(/^\n/, '').split('\x1f');
      return { oid, messageHeadline, authoredAt, author: author || 'unknown', authorAvatarUrl: null };
    }).filter(commit => OID.test(commit.oid));
  }

  private async missing(cwd: string, oids: string[]): Promise<string[]> {
    const output = await this.git.run(cwd, ['cat-file', '--batch-check=%(objecttype)'], {
      operation: 'pr-local-objects', readOnly: true, maxOutputBytes: 64 * 1024, stdin: oids.map(oid => `${oid}^{commit}`).join('\n') + '\n',
    });
    const types = output.stdout.toString('utf8').split('\n');
    return oids.filter((_, index) => types[index]?.trim() !== 'commit');
  }
}

/** An over-limit patch keeps only complete file sections, so every rendered file is whole. */
export function diffResult(path: string, raw: string, truncated: boolean): DiffResult {
  let patch = raw;
  let cut = truncated;
  if (truncated) {
    const last = patch.lastIndexOf('\ndiff --git ');
    patch = last >= 0 ? patch.slice(0, last + 1) : '';
  }
  if (jsonBytes(patch) > PATCH_JSON_LIMIT_BYTES) {
    patch = sectionsThatFit(patch);
    cut = true;
  }
  const binary = /Binary files .* differ|GIT binary patch/.test(patch);
  return { patch, path, binary, truncated: cut, lineCount: patch ? patch.split('\n').length : 0 };
}

/** Keeps every file that still fits, so one huge file doesn't hide the rest of the pull request. */
function sectionsThatFit(patch: string): string {
  let remaining = PATCH_JSON_LIMIT_BYTES;
  let kept = '';
  for (const section of patch.split(/(?=^diff --git )/m)) {
    const size = jsonBytes(section);
    if (size > remaining) continue;
    kept += section;
    remaining -= size;
  }
  return kept;
}

/** Escaping makes the message larger than the patch, by an amount only encoding it can tell. */
function jsonBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
