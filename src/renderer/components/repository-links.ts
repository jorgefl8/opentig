import { createContext } from 'react';

/** Something GitHub links to that OpenTig can also open. */
export type RepositoryLinkTarget =
  | { kind: 'pull'; number: number }
  | { kind: 'commit'; oid: string }
  | { kind: 'release'; tag: string }
  | { kind: 'workflow-run'; runId: number; jobId?: number | undefined };

export interface RepositoryLinks {
  /** The open repository on GitHub, as `owner/name`. */
  nameWithOwner: string;
  open(target: RepositoryLinkTarget): void;
}

/** Present while a GitHub repository is open, so its links can offer OpenTig as well as GitHub. */
export const RepositoryLinksContext = createContext<RepositoryLinks | null>(null);

function decode(segment: string): string | null {
  try { return decodeURIComponent(segment); } catch { return null; }
}

/**
 * Only links into the open repository count, and only what OpenTig can show:
 * a pull request, a full commit hash (the commit viewer needs one), a release,
 * or a workflow run, optionally at one of its jobs.
 */
export function parseRepositoryLink(href: string, nameWithOwner: string): RepositoryLinkTarget | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean).map(decode);
  if (parts.some((part) => part === null) || parts.length < 4) return null;
  const [owner, name, kind, value] = parts as string[];
  if (`${owner}/${name}`.toLowerCase() !== nameWithOwner.toLowerCase()) return null;
  if (kind === 'pull' && /^[1-9]\d{0,9}$/.test(value!)) return { kind: 'pull', number: Number(value) };
  if (kind === 'commit' && parts.length === 4 && /^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(value!)) return { kind: 'commit', oid: value!.toLowerCase() };
  if (kind === 'actions' && value === 'runs' && /^[1-9]\d{0,15}$/.test(parts[4] ?? '')) {
    const job = parts[5] === 'job' && /^[1-9]\d{0,15}$/.test(parts[6] ?? '') ? Number(parts[6]) : undefined;
    return { kind: 'workflow-run', runId: Number(parts[4]), ...(job ? { jobId: job } : {}) };
  }
  if (kind === 'releases' && value === 'tag' && parts.length >= 5) return { kind: 'release', tag: (parts as string[]).slice(4).join('/') };
  return null;
}

export function repositoryLinkUrl(nameWithOwner: string, target: RepositoryLinkTarget): string {
  const base = `https://github.com/${nameWithOwner}`;
  if (target.kind === 'pull') return `${base}/pull/${target.number}`;
  if (target.kind === 'commit') return `${base}/commit/${target.oid}`;
  if (target.kind === 'workflow-run') return `${base}/actions/runs/${target.runId}${target.jobId ? `/job/${target.jobId}` : ''}`;
  return `${base}/releases/tag/${target.tag.split('/').map(encodeURIComponent).join('/')}`;
}

export function repositoryLinkLabel(target: RepositoryLinkTarget): string {
  if (target.kind === 'pull') return `Pull request #${target.number}`;
  if (target.kind === 'commit') return `Commit ${target.oid.slice(0, 7)}`;
  if (target.kind === 'workflow-run') return `Workflow run ${target.runId}`;
  return `Release ${target.tag}`;
}
