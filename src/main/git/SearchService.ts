import { createHash } from 'node:crypto';
import { GitOperationError } from '../../shared/errors';
import {
  findSearchMatches,
  replaceSearchMatches,
  SEARCH_MAX_MATCHES,
  SEARCH_MAX_MATCHES_PER_FILE,
  type SearchOptions,
  type SearchReplaceRequest,
  type SearchReplaceResult,
  type SearchResult,
} from '../../shared/search';
import { MAX_SNAPSHOT_BYTES } from '../files/FileOperationHistory';
import type { FileOperationHistory } from '../files/FileOperationHistory';
import type { FileService, FileSnapshot } from '../files/FileService';
import type { GitProcess } from './GitProcess';
import type { RepositoryService } from './RepositoryService';
import { parseSearchOutput } from './SearchParser';

const EMPTY: SearchResult = { files: [], totalMatches: 0, ignoredMatches: 0, truncated: false };
const REPLACE_FILE_LIMIT = 8 * 1024 * 1024;
/** Matched files read at a time while resolving exact match positions. */
const SEARCH_READ_CONCURRENCY = 16;

/**
 * Searches the working tree with `git grep`. Ignored files are searched too but
 * flagged, so the UI can keep build output and dependencies out of the way
 * without hiding them outright.
 */
export class SearchService {
  constructor(
    private readonly git: GitProcess,
    private readonly repositories: RepositoryService,
    private readonly files: FileService,
    private readonly history: FileOperationHistory,
  ) {}

  async search(repositoryId: string, options: SearchOptions): Promise<SearchResult> {
    const repository = this.repositories.get(repositoryId);
    if (!options.query.trim()) return EMPTY;

    const args = [
      'grep', '--no-color', '--full-name', '--untracked', '--no-exclude-standard', '-I', '-n', '-z',
      '--max-count', String(SEARCH_MAX_MATCHES_PER_FILE),
      options.regex ? '-E' : '-F',
    ];
    if (!options.matchCase) args.push('-i');
    if (options.wholeWord) args.push('-w');
    args.push('-e', options.query, '--');

    let result: SearchResult;
    try {
      const output = await this.git.run(repository.path, args, {
        operation: 'search',
        readOnly: true,
        timeoutMs: 20_000,
        maxOutputBytes: 8 * 1024 * 1024,
      });
      result = parseSearchOutput(output.stdout.toString('utf8'));
    } catch (error) {
      // `git grep` exits with 1 when nothing matched, which is not a failure.
      if (error instanceof GitOperationError && error.detail.exitCode === 1) return EMPTY;
      throw error;
    }

    if (result.files.length === 0) return result;
    const ignored = await this.ignoredPaths(repository.path, result.files.map((file) => file.path));
    const files: SearchResult['files'] = [];
    let totalMatches = 0;
    let ignoredMatches = 0;
    let truncated = result.truncated;
    // Each matched file is re-read to locate exact columns and fingerprint its
    // contents. Reading them one after another turns a wide search into hundreds
    // of sequential round trips, so a bounded number are read at a time while the
    // results are still merged in `git grep` order.
    outer: for (let index = 0; index < result.files.length; index += SEARCH_READ_CONCURRENCY) {
      const batch = result.files.slice(index, index + SEARCH_READ_CONCURRENCY);
      const loaded = await Promise.all(batch.map(async (candidate) => ({
        candidate,
        snapshot: await this.files.snapshot(repositoryId, candidate.path, REPLACE_FILE_LIMIT),
      })));
      for (const { candidate, snapshot } of loaded) {
        // Every discarded file is reported as truncation rather than silently
        // dropped: the result set no longer describes the whole repository, and
        // "replace all" must stay disabled while that is true.
        if (!snapshot) { truncated = true; continue; }
        const content = snapshot.bytes.toString('utf8');
        if (!Buffer.from(content, 'utf8').equals(snapshot.bytes)) { truncated = true; continue; }
        const exact = findSearchMatches(content, options, SEARCH_MAX_MATCHES_PER_FILE + 1);
        // Git matched something this expression cannot reproduce, so the listed
        // matches would be an incomplete view of that file.
        if (exact.length === 0) { truncated = true; continue; }
        const overflowing = exact.length > SEARCH_MAX_MATCHES_PER_FILE;
        if (overflowing) truncated = true;
        const room = SEARCH_MAX_MATCHES - totalMatches;
        if (room <= 0) { truncated = true; break outer; }
        const selected = exact.slice(0, Math.min(SEARCH_MAX_MATCHES_PER_FILE, room));
        if (selected.length < exact.length) truncated = true;
        const lines = content.split(/\r?\n/);
        const file = {
          path: candidate.path,
          ignored: ignored.has(candidate.path),
          revision: revision(snapshot.bytes),
          // Replacing this file would also rewrite the occurrences that are not
          // listed, so the renderer has to say so before it asks.
          truncatedMatches: selected.length < exact.length || overflowing,
          matches: selected.map((match) => ({
            line: match.line,
            column: match.column,
            length: match.end - match.start,
            text: (lines[match.line - 1] ?? '').slice(0, 500),
          })),
        };
        files.push(file);
        totalMatches += file.matches.length;
        if (file.ignored) ignoredMatches += file.matches.length;
      }
    }
    return { files, totalMatches, ignoredMatches, truncated };
  }

  async replace(repositoryId: string, request: SearchReplaceRequest): Promise<SearchReplaceResult> {
    const targets = request.scope.kind === 'all'
      ? request.scope.files
      : [{ path: request.scope.path, revision: request.scope.revision }];
    const unique = new Map(targets.map((target) => [target.path, target]));
    if (unique.size !== targets.length) throw invalidReplacement('Duplicate replacement paths.');
    this.repositories.validatePaths(repositoryId, targets.map((target) => target.path));

    const before: FileSnapshot[] = [];
    const stale: string[] = [];
    for (const target of targets) {
      const snapshot = await this.files.snapshot(repositoryId, target.path, REPLACE_FILE_LIMIT);
      if (!snapshot || revision(snapshot.bytes) !== target.revision) { stale.push(target.path); continue; }
      const content = snapshot.bytes.toString('utf8');
      if (!Buffer.from(content, 'utf8').equals(snapshot.bytes)) { stale.push(target.path); continue; }
      before.push(snapshot);
    }
    if (stale.length) return { status: 'stale', paths: stale };

    const after: FileSnapshot[] = [];
    const changedBefore: FileSnapshot[] = [];
    let replacements = 0;
    const singleMatch = request.scope.kind === 'match' ? request.scope : null;
    for (const snapshot of before) {
      const content = snapshot.bytes.toString('utf8');
      let matches = findSearchMatches(content, request.options);
      if (singleMatch) {
        matches = matches.filter((match) => match.line === singleMatch.line && match.column === singleMatch.column).slice(0, 1);
      }
      if (!matches.length) continue;
      const replaced = replaceSearchMatches(content, matches, request.replacement);
      if (replaced === content) continue;
      changedBefore.push(snapshot);
      after.push({ ...snapshot, bytes: Buffer.from(replaced, 'utf8') });
      replacements += matches.length;
    }
    if (!changedBefore.length) return { status: 'no-match' };
    const historyBytes = [...changedBefore, ...after].reduce((total, item) => total + item.bytes.byteLength, 0);
    if (historyBytes > MAX_SNAPSHOT_BYTES) throw new GitOperationError({ code: 'OUTPUT_LIMIT', operation: 'replace-search', message: 'The replacement is too large to keep safely in undo history.' });

    await this.files.replaceSnapshots(repositoryId, changedBefore, after);
    const changedPaths = changedBefore.map((item) => item.path);
    this.history.recordEdit(repositoryId, changedPaths.length === 1 ? 'Replace in file' : `Replace in ${changedPaths.length} files`, changedBefore, after);
    return { status: 'replaced', replacements, files: changedPaths };
  }

  private async ignoredPaths(cwd: string, paths: string[]): Promise<Set<string>> {
    try {
      const output = await this.git.run(cwd, ['check-ignore', '-z', '--stdin'], {
        operation: 'search-ignored',
        readOnly: true,
        timeoutMs: 10_000,
        stdin: `${paths.join('\0')}\0`,
      });
      return new Set(output.stdout.toString('utf8').split('\0').filter(Boolean));
    } catch (error) {
      // Exit code 1 simply means none of the paths are ignored.
      if (error instanceof GitOperationError && error.detail.exitCode === 1) return new Set();
      throw error;
    }
  }
}

function revision(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function invalidReplacement(message: string): GitOperationError {
  return new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'replace-search', message });
}
