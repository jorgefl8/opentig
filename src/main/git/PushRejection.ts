import type { PushResult } from '../../shared/contracts';
import { GitOperationError } from '../../shared/errors';
import { redactSensitiveText } from '../../shared/redaction';

export type RejectedPush = Extract<PushResult, { status: 'rejected' }>;

/** A ref that Git, or the remote, refused to update. */
export interface RefusedRef {
  /** The local and remote branch, as `<from>:<to>`. */
  ref: string;
  /** Refused by the remote (a hook or rule) rather than by Git before sending. */
  byRemote: boolean;
  /** Git's reason, such as `fetch first`; empty when it gave none. */
  reason: string;
}

/**
 * The refused refs of a `git push --porcelain`, whose stdout has one line per ref:
 * `!<TAB><from>:<to><TAB>[rejected] (<reason>)`, or `[remote rejected]`.
 */
export function refusedRefs(stdout: string): RefusedRef[] {
  const refs: RefusedRef[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^!\t([^\t]+)\t\[(remote )?rejected\](?: \((.*)\))?\s*$/.exec(line);
    if (match) refs.push({ ref: match[1]!, byRemote: Boolean(match[2]), reason: match[3] ?? '' });
  }
  return refs;
}

/** Reasons Git gives when the remote branch has commits the pushed branch lacks. */
const REMOTE_IS_AHEAD = new Set(['non-fast-forward', 'fetch first', 'stale info']);

/**
 * Git's sentences without the URLs and ref names they mention. A branch or
 * repository can be named after any word, such as `fix/expired-token`.
 */
function withoutNames(text: string): string {
  return text
    .replace(/'[^'\s]*'/g, "''")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/^To \S+$/gm, ' ')
    .replace(/\S+ -> \S+/g, ' ')
    .replace(/\brefs\/\S+|\brefspec \S+/g, ' ');
}

/** For when Git reported no refused ref: its English messages, which a hosting service can also word. */
function reasonFromMessage(text: string, code: string | undefined): RejectedPush['reason'] {
  const raw = withoutNames(text).toLowerCase();
  if (/repository not found|repository .* not found|(?:http|error:)\s*404/.test(raw)) return 'inaccessible';
  if (/authentication failed|could not read username|bad credentials|expired|revoked|no usable saved credentials|publickey|(?:http|error:)\s*401/.test(raw)) return 'authentication';
  if (/protected branch|hook declined|pre-receive hook|remote rejected|gh006|gh013|repository rule/.test(raw)) return 'hook';
  if (/permission.*denied|write access.*not granted|access denied|(?:http|error:)\s*403/.test(raw)) return 'permission';
  if (/non-fast-forward|fetch first|stale info|updates were rejected because (?:the remote contains work|the tip of your current branch is behind|a pushed branch tip is behind)/.test(raw)) return 'remote-changed';
  if (/could not resolve host|unable to access|connection.*(timed out|reset|refused)|network is unreachable|(?:http|error:)\s*50[0-4]/.test(raw)) return 'network';
  if (code === 'INVALID_ARGUMENT' || /upstream branch .* does not match|no upstream branch|push\.default|context|account changed/.test(raw)) return 'configuration';
  return 'unknown';
}

function branchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

/**
 * Why a push failed. The refused ref that Git reports is the first signal. What
 * Git printed is returned apart from `message`, which only carries a sentence
 * written by OpenTig.
 */
export function pushFailure(error: unknown): RejectedPush {
  const detail = error instanceof GitOperationError ? error.detail : null;
  const refused = refusedRefs(detail?.stdout ?? '');
  const refusal = refused[0];
  const reason = refusal?.byRemote ? 'hook'
    : refusal && REMOTE_IS_AHEAD.has(refusal.reason) ? 'remote-changed'
    : reasonFromMessage(detail?.stderr || detail?.message || (error instanceof Error ? error.message : ''), detail?.code);
  const refs = refused.map(({ ref, byRemote, reason: why }) => {
    const [from = '', to = from] = ref.split(':');
    return ` ! [${byRemote ? 'remote rejected' : 'rejected'}] ${branchName(from)} -> ${branchName(to)}${why ? ` (${why})` : ''}`;
  });
  const output = [...(refs.length ? refs : [detail?.stdout ?? '']), detail?.stderr ?? ''].filter((part) => part.trim()).join('\n');
  const details = redactSensitiveText(output).trimEnd().slice(0, 3000);
  const message = details ? '' : redactSensitiveText(detail?.message || (error instanceof Error ? error.message : '') || 'Git rejected the push.').trim().slice(0, 3000);
  return { status: 'rejected', reason, message, ...(details ? { details } : {}), ...(detail?.access ? { access: detail.access } : {}) };
}
