import { GitOperationError } from '../../shared/errors';
import { SEARCH_MAX_MATCHES_PER_FILE, type SearchOptions, type SearchResult } from '../../shared/search';
import type { GitProcess } from './GitProcess';
import type { RepositoryService } from './RepositoryService';
import { parseSearchOutput } from './SearchParser';

const EMPTY: SearchResult = { files: [], totalMatches: 0, ignoredMatches: 0, truncated: false };

/**
 * Searches the working tree with `git grep`. Ignored files are searched too but
 * flagged, so the UI can keep build output and dependencies out of the way
 * without hiding them outright.
 */
export class SearchService {
  constructor(private readonly git: GitProcess, private readonly repositories: RepositoryService) {}

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
    let ignoredMatches = 0;
    for (const file of result.files) {
      file.ignored = ignored.has(file.path);
      if (file.ignored) ignoredMatches += file.matches.length;
    }
    return { ...result, ignoredMatches };
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
