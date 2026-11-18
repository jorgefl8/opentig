import type { CliCandidate } from '../ai/CliResolver';
import type { CliRunResult } from '../ai/CliProcessRunner';
import { COMMIT_AUTHOR_AVATAR_READ_TIMEOUT_MS } from '../../shared/operation-timeouts';
import type { GhRunOptions, GitHubTarget } from './GitHubAccess';

export const COMMIT_AUTHOR_AVATAR_OPERATION = 'gh-commit-author-avatar';
const COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
/** Where GitHub serves account pictures; any other answer is not shown. */
const AVATAR_HOST = 'avatars.githubusercontent.com';
/** Twice the card's avatar, for sharp pictures on high-density screens. */
const AVATAR_PIXELS = 64;
/** One `gh api` call; the whole lookup is bounded by `COMMIT_AUTHOR_AVATAR_READ_TIMEOUT_MS`. */
const GH_TIMEOUT_MS = 10_000;
/** Only the picture leaves GitHub CLI, not the commit's files and patches. */
const AVATAR_JQ = '.author.avatar_url // ""';
/** Authors and commits remembered per server; the oldest are forgotten past this. */
const MAX_REMEMBERED = 2_000;

/** What `CommitAuthorAvatars` needs from `GitHubService`, which owns routing and credentials. */
export interface CommitAuthorAvatarAccess {
  /** The repository's folder and the GitHub repository of the remote the other GitHub features use, if any. */
  repository(repositoryId: string): Promise<{ path: string; nameWithOwner: string | null }>;
  /** The commit's author e-mail as Git recorded it; null when Git can't read the commit. */
  authorEmail(cwd: string, oid: string): Promise<string | null>;
  requireGitHub(repositoryId: string, operation: string): Promise<GitHubTarget>;
  run(executable: CliCandidate, args: string[], options: GhRunOptions): Promise<CliRunResult>;
}

/**
 * GitHub's answer for one commit. `author` is what GitHub links the commit's e-mail to, and so holds
 * for every commit with that e-mail; `missing` means GitHub doesn't have the commit (not pushed).
 */
type Outcome = { kind: 'author'; url: string | null } | { kind: 'missing' } | { kind: 'failed' };

/** The picture in `gh api …/commits/<oid> --jq '.author.avatar_url // ""'`, when it is one GitHub serves. */
export function parseCommitAuthorAvatar(stdout: string): string | null {
  const value = stdout.trim();
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== AVATAR_HOST || url.port || url.username || url.password) return null;
  url.searchParams.set('s', String(AVATAR_PIXELS));
  url.hash = '';
  return url.toString();
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_REMEMBERED) map.delete(map.keys().next().value as K);
}

/**
 * The GitHub picture of a blamed commit's author, asked from GitHub through the repository's GitHub
 * account and remote. Blame only knows the author's name and e-mail, so GitHub's answer for the
 * commit is what links it to an account. The e-mail itself never leaves the machine: it only keys
 * what is remembered, so one author is asked about once per GitHub repository while the server runs.
 *
 * Every failure is an answer of no picture: the card it decorates shows a placeholder instead.
 * Failures that may pass (no access yet, a slow or unreachable GitHub) are not remembered.
 */
export class CommitAuthorAvatars {
  /** GitHub's answer per GitHub repository and author e-mail, a picture or none. */
  private readonly authors = new Map<string, string | null>();
  /** Commits GitHub said it doesn't have, per GitHub repository. */
  private readonly missing = new Map<string, true>();
  /** The read under way per author, and the commit it asks about. */
  private readonly pending = new Map<string, { oid: string; outcome: Promise<Outcome> }>();

  constructor(private readonly access: CommitAuthorAvatarAccess, private readonly timeoutMs = COMMIT_AUTHOR_AVATAR_READ_TIMEOUT_MS) {}

  /** Never fails and never takes longer than the timeout: null stands for every reason there is no picture. */
  async avatar(repositoryId: string, oid: string): Promise<string | null> {
    // Checked again here, since it becomes part of a GitHub URL.
    if (!COMMIT_OID.test(oid)) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), this.timeoutMs); });
    try {
      return await Promise.race([this.lookup(repositoryId, oid.toLowerCase()).catch(() => null), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async lookup(repositoryId: string, oid: string): Promise<string | null> {
    const { path, nameWithOwner } = await this.access.repository(repositoryId);
    if (!nameWithOwner) return null;
    const email = (await this.access.authorEmail(path, oid))?.trim().toLowerCase();
    if (!email) return null;
    const repository = nameWithOwner.toLowerCase();
    const author = JSON.stringify([repository, email]);
    const commit = JSON.stringify([repository, oid]);
    if (this.authors.has(author)) return this.authors.get(author) ?? null;
    if (this.missing.has(commit)) return null;
    const shared = this.pending.get(author);
    if (shared) {
      const outcome = await shared.outcome;
      if (outcome.kind === 'author') return outcome.url;
      // GitHub not having another commit by this author says nothing of this one.
      if (outcome.kind === 'failed' || shared.oid === oid) return null;
      if (this.authors.has(author)) return this.authors.get(author) ?? null;
    }
    const outcome = this.ask(repositoryId, oid, author, commit);
    const answer = await outcome;
    return answer.kind === 'author' ? answer.url : null;
  }

  private ask(repositoryId: string, oid: string, author: string, commit: string): Promise<Outcome> {
    const outcome = this.read(repositoryId, oid).then((answer) => {
      if (answer.kind === 'author') remember(this.authors, author, answer.url);
      else if (answer.kind === 'missing') remember(this.missing, commit, true);
      return answer;
    }).finally(() => {
      if (this.pending.get(author)?.outcome === outcome) this.pending.delete(author);
    });
    this.pending.set(author, { oid, outcome });
    return outcome;
  }

  private async read(repositoryId: string, oid: string): Promise<Outcome> {
    try {
      const target = await this.access.requireGitHub(repositoryId, COMMIT_AUTHOR_AVATAR_OPERATION);
      const result = await this.access.run(target.executable, ['api', `repos/${target.nameWithOwner}/commits/${oid}`, '--jq', AVATAR_JQ], {
        auth: target.auth, executable: target.executable, cwd: target.repository.path, operation: COMMIT_AUTHOR_AVATAR_OPERATION,
        timeoutMs: GH_TIMEOUT_MS, maxOutputBytes: 64 * 1024,
      });
      if (result.exitCode === 0) return { kind: 'author', url: parseCommitAuthorAvatar(result.stdout) };
      // GitHub answers 422 for a commit it doesn't have, such as one not pushed yet.
      return /\(HTTP 422\)/i.test(result.stderr) ? { kind: 'missing' } : { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }
}
