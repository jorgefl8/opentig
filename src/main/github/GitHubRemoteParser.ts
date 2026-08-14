const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Extracts `owner/repo` from a Git remote URL when it points at github.com.
 * Detection is purely local: no network and no gh invocation are involved.
 */
export function parseGitHubRemote(url: string): { nameWithOwner: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let rest: string | null = null;
  const https = /^https?:\/\/(?:[^@/\s]+@)?github\.com\/(.+)$/i.exec(trimmed);
  const ssh = /^ssh:\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/(.+)$/i.exec(trimmed);
  const scp = /^(?:[^@\s]+)@github\.com:(.+)$/i.exec(trimmed);
  const git = /^git:\/\/github\.com\/(.+)$/i.exec(trimmed);
  if (https) rest = https[1] ?? null;
  else if (ssh) rest = ssh[1] ?? null;
  else if (scp) rest = scp[1] ?? null;
  else if (git) rest = git[1] ?? null;
  if (!rest) return null;

  const segments = rest.replace(/\/+$/, '').split('/');
  if (segments.length !== 2) return null;
  const owner = segments[0] ?? '';
  const repo = (segments[1] ?? '').replace(/\.git$/i, '');
  if (!OWNER_PATTERN.test(owner) || !repo || repo === '.' || repo === '..' || !REPO_PATTERN.test(repo)) return null;
  return { nameWithOwner: `${owner}/${repo}` };
}
