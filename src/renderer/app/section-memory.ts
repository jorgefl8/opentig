import type { RepositoryStatus } from '../../shared/git-types';
import type { ViewerSelection } from '@/features/viewer/Viewer';

/** Sections × repositories remembered: five sections of the last twenty repositories or worktrees. */
const MAX_REMEMBERED = 100;

/**
 * What each section of each repository last showed in the viewer, so going back
 * to a section shows it again instead of nothing. Oldest entries go first once
 * the limit is reached.
 */
export class SectionSelections {
  private readonly entries = new Map<string, NonNullable<ViewerSelection>>();

  constructor(private readonly limit = MAX_REMEMBERED) {}

  remember(repositoryId: string, section: string, selection: ViewerSelection): void {
    const key = sectionKey(repositoryId, section);
    this.entries.delete(key);
    if (!selection) return;
    this.entries.set(key, selection);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }

  recall(repositoryId: string, section: string): ViewerSelection {
    return this.entries.get(sectionKey(repositoryId, section)) ?? null;
  }

  get size(): number {
    return this.entries.size;
  }
}

function sectionKey(repositoryId: string, section: string): string {
  return `${repositoryId}\0${section}`;
}

/**
 * Whether a remembered selection still describes something there is to show.
 * A change that was committed, staged or discarded meanwhile, and a file whose
 * tab was closed, are not brought back: the section shows nothing selected, as
 * it did before it remembered anything. A status not read yet keeps the choice;
 * the viewer then reads the change itself.
 */
export function stillShowable(selection: ViewerSelection, context: { status: RepositoryStatus | null; openTabs: ReadonlySet<string> }): boolean {
  if (!selection) return false;
  if (selection.type === 'file') return context.openTabs.has(selection.path);
  if (selection.type === 'diff') {
    if (!context.status) return true;
    return context.status.changes.some((change) => change.path === selection.path
      && !change.conflict && (selection.kind === 'staged' ? change.staged : change.unstaged));
  }
  if (selection.type === 'conflict') {
    if (!context.status) return true;
    return context.status.changes.some((change) => change.path === selection.path && change.conflict);
  }
  return true;
}
