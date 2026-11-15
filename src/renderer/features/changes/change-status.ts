import type { ChangeKind } from '../../../shared/git-types';

// A conflict is `!`, a warning rather than a letter, so every letter keeps one meaning.
// A copy is a new file, so it shares `A` with added.
const STATUS_CODES = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'A', untracked: 'U', conflicted: '!', 'type-changed': 'T' } as const satisfies Record<ChangeKind, string>;
const STATUS_LABELS = { modified: 'Modified', added: 'Added', deleted: 'Deleted', renamed: 'Renamed', copied: 'Copied', untracked: 'Untracked', conflicted: 'Conflicted', 'type-changed': 'Type changed' } as const satisfies Record<ChangeKind, string>;

export function changeStatusCode(kind: ChangeKind): string {
  return STATUS_CODES[kind];
}

/** What the status letter stands for, for assistive technology. */
export function changeStatusLabel(kind: ChangeKind): string {
  return STATUS_LABELS[kind];
}
