import type { ViewerSelection } from '@/features/viewer/Viewer';
import { rememberedTab } from '@/features/viewer/viewer-memory';
import type { NavigationLocation, SidebarView } from './location';

/**
 * The web build's addresses. Every one starts with `/r/<repository id>`, which no
 * file, API route or socket of the server uses, so an address never hides them:
 *
 *   /r/<id>                                   the repository, in Files
 *   /r/<id>/changes | files | history | github | search
 *   /r/<id>/changes/staged/<path>             a staged change; also unstaged/ and conflict/
 *   /r/<id>/file/<path>#L40                   a file in Files, at a line
 *   /r/<id>/commit/<oid>                      a commit (its full object id)
 *   /r/<id>/commit/<oid>/file/<path>?from=<old path>
 *   /r/<id>/history?history-of=<path>         History narrowed to one file; the parameter
 *                                             also goes on a commit opened from there
 *   /r/<id>/pr/24 | /pr/24/comments | checks | timeline | code
 *   /r/<id>/release/<tag>
 *   /r/<id>/run/<run id>                      a workflow run; /run/<id>/job/<job id> for one job
 *
 * Each path segment is percent-encoded on its own. Scroll positions are not part of
 * an address: they stay in the browser's history entry.
 */

export const PULL_REQUEST_ADDRESS_TABS = ['summary', 'comments', 'checks', 'timeline', 'code'] as const;
export type PullRequestAddressTab = (typeof PULL_REQUEST_ADDRESS_TABS)[number];

/** Where an address leads, before anything checks that it exists. */
export interface AddressTarget {
  repositoryId: string;
  /** The section, when the address names one; otherwise the one its selection belongs to. */
  view: SidebarView;
  selection: ViewerSelection;
  fileHistory: string | null;
  line: number | null;
  pullTab: PullRequestAddressTab | null;
}

export type ParsedAddress =
  | { kind: 'none' }
  | { kind: 'target'; target: AddressTarget }
  | { kind: 'malformed' };

const SECTION_SEGMENTS: Readonly<Record<string, SidebarView>> = { changes: 'changes', files: 'files', history: 'history', github: 'prs', search: 'search' };
const MAX_PATH_LENGTH = 4096;
const MAX_LINE = 10_000_000;

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const sectionSegment = (view: SidebarView) => view === 'prs' ? 'github' : view;

/** The section an item opens in when an address names the item but not the section. */
export function homeSection(selection: ViewerSelection): SidebarView | null {
  if (!selection) return null;
  if (selection.type === 'diff' || selection.type === 'conflict') return 'changes';
  if (selection.type === 'file') return 'files';
  if (selection.type === 'commit' || selection.type === 'commit-file') return 'history';
  return 'prs';
}

/** The address of a location. `pullTab` is the tab its pull request shows, which the viewer keeps. */
export function addressOf(location: NavigationLocation, pullTab: PullRequestAddressTab | null = null): string {
  const base = `/r/${encodeURIComponent(location.repositoryId)}`;
  const selection = location.selection;
  const query = new URLSearchParams();
  let path: string;
  let hash = '';
  if (!selection) path = `${base}/${sectionSegment(location.view)}`;
  else if (selection.type === 'diff') path = `${base}/changes/${selection.kind}/${encodePath(selection.path)}`;
  else if (selection.type === 'conflict') path = `${base}/changes/conflict/${encodePath(selection.path)}`;
  else if (selection.type === 'file') {
    path = `${base}/file/${encodePath(selection.path)}`;
    if (location.line !== null) hash = `#L${location.line}`;
  } else if (selection.type === 'commit') path = `${base}/commit/${selection.oid}`;
  else if (selection.type === 'commit-file') {
    path = `${base}/commit/${selection.oid}/file/${encodePath(selection.path)}`;
    if (selection.oldPath && selection.oldPath !== selection.path) query.set('from', selection.oldPath);
  } else if (selection.type === 'pull-request') path = `${base}/pr/${selection.number}${pullTab && pullTab !== 'summary' ? `/${pullTab}` : ''}`;
  else if (selection.type === 'release') path = `${base}/release/${encodePath(selection.tag)}`;
  else path = `${base}/run/${selection.runId}${selection.jobId ? `/job/${selection.jobId}` : ''}`;
  if (location.fileHistory && location.view === 'history') query.set('history-of', location.fileHistory.path);
  const search = query.toString();
  return `${path}${search ? `?${search}` : ''}${hash}`;
}

/** Whether a path is one of the app's addresses, which the server answers with the app. */
export function isAppAddress(pathname: string): boolean {
  return pathname === '/r' || pathname.startsWith('/r/');
}

/**
 * Reads an address. It comes from outside (a pasted link, a bookmark), so every
 * part is checked: the repository id's characters, full object ids, whole numbers
 * in range, file paths that stay inside the worktree, and tags Git would accept.
 * Nothing in it is acted on here; whether its repository and item exist is checked
 * when it is opened.
 */
export function parseAddress(pathname: string, search: string, hash: string): ParsedAddress {
  if (!isAppAddress(pathname)) return { kind: 'none' };
  const raw = pathname.split('/').slice(2);
  if (raw.length > 0 && raw.at(-1) === '') raw.pop();
  const segments: string[] = [];
  for (const part of raw) {
    const decoded = decode(part);
    if (decoded === null) return { kind: 'malformed' };
    segments.push(decoded);
  }
  const [repositoryId, kind, ...rest] = segments;
  if (!repositoryId || !/^[A-Za-z0-9_-]{1,128}$/.test(repositoryId)) return { kind: 'malformed' };
  const params = new URLSearchParams(search);
  const target = (view: SidebarView, selection: ViewerSelection, extra: Partial<AddressTarget> = {}): ParsedAddress => ({
    kind: 'target', target: { repositoryId, view, selection, fileHistory: null, line: null, pullTab: null, ...extra },
  });
  const historyOf = () => {
    const value = params.get('history-of');
    return value === null ? null : safePath(value);
  };

  if (kind === undefined) return target('files', null);
  const section = SECTION_SEGMENTS[kind];
  if (section) {
    if (section === 'changes' && rest.length >= 2) {
      const mode = rest[0];
      const path = safePath(rest.slice(1).join('/'));
      if (!path) return { kind: 'malformed' };
      if (mode === 'staged' || mode === 'unstaged') return target('changes', { type: 'diff', path, kind: mode });
      if (mode === 'conflict') return target('changes', { type: 'conflict', path });
      return { kind: 'malformed' };
    }
    if (rest.length > 0) return { kind: 'malformed' };
    if (section === 'history') {
      const fileHistory = historyOf();
      if (params.has('history-of') && !fileHistory) return { kind: 'malformed' };
      return target('history', null, { fileHistory });
    }
    return target(section, null);
  }
  if (kind === 'file') {
    const path = safePath(rest.join('/'));
    if (!path) return { kind: 'malformed' };
    let line: number | null = null;
    if (hash && hash !== '#') {
      const match = /^#L([1-9][0-9]{0,7})$/.exec(hash);
      if (!match || Number(match[1]) > MAX_LINE) return { kind: 'malformed' };
      line = Number(match[1]);
    }
    return target('files', { type: 'file', path }, { line });
  }
  if (kind === 'commit') {
    const [oid, fileSegment, ...pathParts] = rest;
    if (!oid || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) return { kind: 'malformed' };
    const fileHistory = historyOf();
    if (params.has('history-of') && !fileHistory) return { kind: 'malformed' };
    if (fileSegment === undefined) return target('history', { type: 'commit', oid, subject: oid.slice(0, 8) }, { fileHistory });
    const path = fileSegment === 'file' ? safePath(pathParts.join('/')) : null;
    if (!path) return { kind: 'malformed' };
    const from = params.get('from');
    const oldPath = from === null ? undefined : safePath(from);
    if (oldPath === null) return { kind: 'malformed' };
    return target('history', { type: 'commit-file', oid, path, ...(oldPath ? { oldPath } : {}) }, { fileHistory });
  }
  if (kind === 'pr') {
    const [number, tab, ...extra] = rest;
    const value = wholeNumber(number);
    if (value === null || value > 2_147_483_647 || extra.length > 0) return { kind: 'malformed' };
    if (tab !== undefined && !(PULL_REQUEST_ADDRESS_TABS as readonly string[]).includes(tab)) return { kind: 'malformed' };
    return target('prs', { type: 'pull-request', number: value }, { pullTab: (tab as PullRequestAddressTab | undefined) ?? 'summary' });
  }
  if (kind === 'release') {
    const tag = rest.join('/');
    if (!isSafeTag(tag)) return { kind: 'malformed' };
    return target('prs', { type: 'release', tag });
  }
  if (kind === 'run') {
    const [run, jobSegment, job, ...extra] = rest;
    const runId = wholeNumber(run);
    if (runId === null || extra.length > 0) return { kind: 'malformed' };
    if (jobSegment === undefined) return target('prs', { type: 'workflow-run', runId });
    const jobId = jobSegment === 'job' ? wholeNumber(job) : null;
    if (jobId === null) return { kind: 'malformed' };
    return target('prs', { type: 'workflow-run', runId, jobId });
  }
  return { kind: 'malformed' };
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

function wholeNumber(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * A path relative to the worktree that cannot leave it: no empty, `.` or `..`
 * parts, no absolute or drive paths, no backslashes, no control characters, and
 * nothing inside a `.git` folder at any depth. The server checks paths again before reading them.
 */
export function safePath(value: string): string | null {
  if (!value || value.length > MAX_PATH_LENGTH) return null;
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is refused.
  if (/[\u0000-\u001f\u007f\\]/.test(value) || /^[A-Za-z]:/.test(value)) return null;
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  if (parts.some((part) => part.toLowerCase() === '.git')) return null;
  return value;
}

/** What `git check-ref-format` accepts for a tag, and never something that reads as an option. */
function isSafeTag(tag: string): boolean {
  if (!tag || tag.length > 255 || tag.startsWith('-') || tag.startsWith('/') || tag.endsWith('/') || tag.endsWith('.')) return false;
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is refused.
  if (/[\u0000- \u007f~^:?*[\\]/.test(tag) || tag.includes('..') || tag.includes('@{') || tag.includes('//') || tag === '@') return false;
  return tag.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

/** The location an address leads to, with what a location keeps that an address does not. */
export function locationOf(target: AddressTarget): NavigationLocation {
  return {
    repositoryId: target.repositoryId,
    view: target.view,
    selection: target.selection,
    fileHistory: target.fileHistory ? { path: target.fileHistory, returnTo: { view: 'history', selection: null } } : null,
    line: target.line,
    pane: target.selection ? 'viewer' : 'list',
  };
}

const PULL_REQUEST_VIEWER_TABS = ['summary', 'comments', 'checks', 'timeline', 'diff'] as const;

/** The address of a location, with the tab its pull request shows now. */
export function currentAddressOf(location: NavigationLocation): string {
  const selection = location.selection;
  const tab = selection?.type === 'pull-request' ? rememberedTab(`${location.repositoryId}:pull:${selection.number}`, PULL_REQUEST_VIEWER_TABS) : null;
  return addressOf(location, tab === 'diff' ? 'code' : tab);
}
