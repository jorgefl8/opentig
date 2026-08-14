import { GitOperationError } from '../../shared/errors';
import { SEARCH_MAX_MATCHES_PER_FILE, type SearchOptions, type SearchResult } from '../../shared/search';
import type { GitProcess } from './GitProcess';
import type { RepositoryService } from './RepositoryService';
import { parseSearchOutput } from './SearchParser';

const EMPTY: SearchResult = { files: [], totalMatches: 0, truncated: false };

/** Searches the working tree with `git grep`, which already honours .gitignore. */
export class SearchService {
  constructor(private readonly git: GitProcess, private readonly repositories: RepositoryService) {}

  async search(repositoryId: string, options: SearchOptions): Promise<SearchResult> {
    const repository = this.repositories.get(repositoryId);
    if (!options.query.trim()) return EMPTY;

    const args = [
      'grep', '--no-color', '--full-name', '--untracked', '-I', '-n', '-z',
      '--max-count', String(SEARCH_MAX_MATCHES_PER_FILE),
      options.regex ? '-E' : '-F',
    ];
    if (!options.matchCase) args.push('-i');
    if (options.wholeWord) args.push('-w');
    args.push('-e', options.query, '--');

    try {
      const output = await this.git.run(repository.path, args, {
        operation: 'search',
        readOnly: true,
        timeoutMs: 20_000,
        maxOutputBytes: 8 * 1024 * 1024,
      });
      return parseSearchOutput(output.stdout.toString('utf8'));
    } catch (error) {
      // `git grep` exits with 1 when nothing matched, which is not a failure.
      if (error instanceof GitOperationError && error.detail.exitCode === 1) return EMPTY;
      throw error;
    }
  }
}
