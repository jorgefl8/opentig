import type { ChangeKind } from '../../../shared/git-types';
import { changeStatusCode, changeStatusLabel } from './change-status';

/** The status letter at the end of a file row, the same wherever changed files are listed. */
export function ChangeStatusBadge({ kind }: { kind: ChangeKind }) {
  return <span className="status-code" data-kind={kind} role="img" aria-label={changeStatusLabel(kind)}>{changeStatusCode(kind)}</span>;
}
