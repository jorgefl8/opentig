import type { OpenTigApi } from '../../../shared/contracts';
import type { FileChange, FileTreeEntry } from '../../../shared/git-types';

export type DestructiveAction =
  | {
      kind: 'discard';
      repositoryId: string;
      paths: string[];
      hasUntracked: boolean;
    }
  | {
      kind: 'delete';
      repositoryId: string;
      paths: string[];
    };

export interface DestructiveActionCopy {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
}

type DeleteResult = Awaited<ReturnType<OpenTigApi['repository']['deleteEntries']>>;

export type DestructiveActionResult =
  | { kind: 'discard' }
  | { kind: 'delete'; result: DeleteResult };

export interface DestructiveActionCommands {
  discard(repositoryId: string, paths: string[]): Promise<{ ok: true }>;
  deleteEntries(repositoryId: string, paths: string[]): Promise<DeleteResult>;
}

export function createDiscardAction(
  repositoryId: string,
  paths: string[],
  changes: FileChange[],
): DestructiveAction {
  const selected = new Set(paths);
  return {
    kind: 'discard',
    repositoryId,
    paths: [...paths],
    hasUntracked: changes.some((change) => selected.has(change.path) && change.kind === 'untracked'),
  };
}

export function createDeleteAction(
  repositoryId: string,
  entries: FileTreeEntry[],
): DestructiveAction {
  return { kind: 'delete', repositoryId, paths: entries.map((entry) => entry.path) };
}

export function destructiveActionCopy(action: DestructiveAction): DestructiveActionCopy {
  if (action.kind === 'discard') {
    return {
      title: 'Discard changes',
      message: action.hasUntracked
        ? 'Untracked files will be moved to system Trash. Other local changes will be lost.'
        : 'These local changes will be lost.',
      detail: action.paths.join('\n'),
      confirmLabel: 'Discard',
    };
  }
  return {
    title: action.paths.length === 1 ? 'Delete item' : `Delete ${action.paths.length} items`,
    message: action.paths.length === 1
      ? 'Move this item to system Trash?'
      : `Move ${action.paths.length} items to system Trash?`,
    detail: action.paths.join('\n'),
    confirmLabel: 'Move to Trash',
  };
}

export async function dispatchDestructiveAction(
  action: DestructiveAction,
  confirmed: boolean,
  commands: DestructiveActionCommands,
): Promise<DestructiveActionResult | null> {
  if (!confirmed) return null;
  if (action.kind === 'discard') {
    await commands.discard(action.repositoryId, action.paths);
    return { kind: 'discard' };
  }
  return {
    kind: 'delete',
    result: await commands.deleteEntries(action.repositoryId, action.paths),
  };
}
