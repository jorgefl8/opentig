export type AccessState = 'unchecked' | 'ok' | 'expired' | 'inaccessible' | 'offline' | 'external' | 'stale';
export interface AccessCheck { state: AccessState; message?: string }
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
  blocked?: string;
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
