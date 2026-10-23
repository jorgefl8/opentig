import { z } from 'zod';
import type { RepositoryInfo } from './contracts';

export const ONBOARDING_VERSION = 1;

export interface GitToolStatus {
  state: 'ready' | 'missing' | 'error';
  version?: string;
  message?: string;
  platform: 'win32' | 'darwin' | 'linux' | 'other';
}

export interface CloneRepositoryInput {
  url: string;
  parentPath: string;
  folderName: string;
}

/** A clone runs as a server job so a dropped connection or reload never cancels it. */
export interface CloneJob {
  id: string;
  name: string;
  destination: string;
  state: 'running' | 'completed' | 'cancelled' | 'failed';
  phase: string;
  /** Overall progress across Git's phases, or null while it is unknown. */
  percent: number | null;
  /** Transferred size reported by Git, for example "41.20 MiB". */
  received: string | null;
  repository: RepositoryInfo | null;
  error: string | null;
}

export const gitIdentityInputSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^<>]+$/).refine(noControls),
  email: z.string().trim().max(254).regex(/^[^\s<>@]+@[^\s<>@]+$/).refine(noControls),
});
export type GitIdentityInput = z.infer<typeof gitIdentityInputSchema>;

export function cloneFolderName(url: string): string {
  return url.trim().replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') ?? '';
}

export interface CloneSource { host: string; transport: 'HTTPS' | 'HTTP' | 'SSH' }

const KNOWN_HOSTS: Record<string, string> = { 'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'bitbucket.org': 'Bitbucket', 'codeberg.org': 'Codeberg' };

/** Describes a valid clone URL for display; null while the URL is incomplete. */
export function cloneSource(url: string): CloneSource | null {
  const value = url.trim();
  if (cloneUrlError(value)) return null;
  const scp = /^[^@]+@([^:]+):/.exec(value);
  const hostname = scp ? scp[1]! : new URL(value).hostname;
  const transport = scp || value.startsWith('ssh:') ? 'SSH' : value.startsWith('http:') ? 'HTTP' : 'HTTPS';
  return { host: KNOWN_HOSTS[hostname.toLowerCase()] ?? hostname, transport };
}

/** Network Git transports only. Credentials stay in Git's credential helpers/SSH. */
export function cloneUrlError(url: string): string | null {
  if (!url || url.length > 4096 || /\s/.test(url) || hasControlCharacters(url)) return 'Enter an HTTPS or SSH repository URL.';
  if (/^(https?|ssh):\/\//.test(url)) {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || parsed.hostname.startsWith('-') || parsed.pathname === '/' || parsed.password || parsed.search || parsed.hash || (parsed.protocol !== 'ssh:' && parsed.username)) {
        return 'Use a repository URL without embedded credentials, query parameters, or fragments.';
      }
    } catch { return 'Enter a valid repository URL.'; }
    return null;
  }
  // SCP-style SSH, e.g. git@github.com:owner/repository.git. Neither part may look like an option.
  return /^[a-zA-Z0-9._][a-zA-Z0-9._-]*@[a-zA-Z0-9.][a-zA-Z0-9.-]*:[^\s?#-][^\s?#]*$/.test(url) ? null : 'Enter an HTTPS or SSH repository URL.';
}

export function cloneInputError(input: CloneRepositoryInput): string | null {
  const { url, parentPath, folderName } = input;
  const urlError = cloneUrlError(url);
  if (urlError) return urlError;
  if (!parentPath.trim() || hasControlCharacters(parentPath)) return 'Choose a destination folder.';
  if (!folderName || folderName.length > 150 || folderName !== folderName.trim() || /[\\/:*?"<>|]/.test(folderName) || hasControlCharacters(folderName) || /[. ]$/.test(folderName) || /^(\.{1,2}|\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(folderName)) {
    return 'Choose a valid repository folder name without path separators.';
  }
  return null;
}

// Git reports each phase from 0 to 100%. Weighting them keeps one bar moving forward.
const PHASES: Record<string, [start: number, span: number, label: string]> = {
  'Receiving objects': [0, 80, 'Receiving objects'],
  'Resolving deltas': [80, 15, 'Resolving deltas'],
  'Updating files': [95, 5, 'Checking out files'],
};

/** Parses one line of `git clone --progress` output. */
export function parseCloneProgress(line: string): Pick<CloneJob, 'phase' | 'percent' | 'received'> | null {
  const match = /(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s*(\d+)%/.exec(line);
  if (!match) return null;
  const weight = PHASES[match[1]!];
  const received = match[1] === 'Receiving objects' ? /,\s*([\d.]+ [KMG]iB)/.exec(line)?.[1] ?? null : null;
  if (!weight) return { phase: 'Preparing objects', percent: null, received: null };
  const percent = Math.min(100, Math.round(weight[0] + weight[1] * Math.min(100, Number(match[2])) / 100));
  return { phase: weight[2], percent, received };
}

/** Turns Git's clone stderr into an actionable message without credentials or URLs. */
export function cloneFailureMessage(stderr: string, account: string | null = null): string {
  if (account && /Authentication failed|could not read Username|terminal prompts disabled|403|Repository not found|not found/i.test(stderr)) {
    return `The GitHub account @${account} cannot access this repository, and no other connected account can. Connect an account with access in Settings → GitHub, or use an SSH URL.`;
  }
  if (/Authentication failed|could not read Username|terminal prompts disabled|403/i.test(stderr)) return 'Authentication failed. Sign in with your Git credential helper, or use an SSH URL with a key that has access.';
  if (/Permission denied \(publickey/i.test(stderr)) return 'SSH key rejected. Add your public key to the Git host, or use the HTTPS URL.';
  if (/Host key verification failed/i.test(stderr)) return 'The SSH host is not trusted yet. Connect once from a terminal with ssh to confirm its fingerprint, then try again.';
  if (/Repository not found|not found|does not appear to be a git repository/i.test(stderr)) return 'Repository not found. Check the URL and that your account can access it.';
  if (/Could not resolve host|unable to access|Connection (timed out|refused)|Network is unreachable/i.test(stderr)) return 'Could not reach the Git host. Check the URL and your network connection.';
  return 'Could not clone the repository.';
}

function noControls(value: string): boolean {
  return !hasControlCharacters(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
