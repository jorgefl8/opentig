import type { ChangeKind } from '../../../shared/git-types';

export function changeStatusCode(kind: ChangeKind): string {
  return ({ modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U', conflicted: 'C', 'type-changed': 'T' } as const)[kind];
}
