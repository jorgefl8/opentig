export type AccessState = 'unchecked' | 'ok' | 'expired' | 'inaccessible' | 'offline' | 'external' | 'stale';
export interface AccessCheck { state: AccessState; message?: string }
/** Why OpenTig refuses to push with the current Git configuration. */
export type PublicationBlockReason =
  | 'unknown-remote' | 'multiple-merge' | 'push-default' | 'upstream-name' | 'upstream-remote'
  | 'push-refspec' | 'mirror' | 'multiple-urls' | 'remote-unavailable';
/**
 * The branch tracks a branch with another name on the remote it pushes to, so
 * a plain push would update that branch (`origin/dev`) instead of its own.
 */
export interface UpstreamNameMismatch {
  remote: string;
  /** The upstream branch's short name, such as `dev`. */
  branch: string;
  /** Commits on HEAD that the upstream doesn't have, or null when Git can't count them. */
  ahead: number | null;
}
export interface PublicationContext {
  id: string;
  repositoryId: string;
  branch: string | null;
  oid: string | null;
  targetRef: string | null;
  remote: string | null;
  urls: string[];
  remotes: string[];
  mode: 'managed' | 'external';
  login: string | null;
  /** Whether this branch already tracks a remote branch. */
  hasUpstream?: boolean;
  blocked?: string;
  blockedReason?: PublicationBlockReason;
  /** Set when publishing under the branch's own name is offered instead of pushing to its upstream. */
  upstreamMismatch?: UpstreamNameMismatch;
}
export interface RepositoryAccess {
  publication: PublicationContext;
  identity: AccessCheck;
  api: AccessCheck;
  read: AccessCheck;
  write: AccessCheck;
  checkedAt: string | null;
  lastOperation?: { operation: string; url: string; login: string | null; at: string; ok: boolean; message?: string };
}

/**
 * Why a fetch, pull or push could not reach a GitHub repository. `login` is
 * the account OpenTig used, or null for Git's own credentials; `candidates`
 * are other connected accounts that can access it over HTTPS.
 */
export interface RemoteAccessProblem {
  repository: string;
  transport: 'https' | 'ssh';
  login: string | null;
  candidates: string[];
  /** The organisation requires authorising the token with SAML single sign-on. */
  sso: boolean;
  /** The account OpenTig switched this repository to after the failure. */
  switchedTo?: string;
}
