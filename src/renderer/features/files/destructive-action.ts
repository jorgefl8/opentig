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
      message: `Discard changes to ${action.paths.length === 1 ? 'this file' : `these ${action.paths.length} files`}?`,
      detail: action.hasUntracked
        ? 'Untracked files will be moved to the Recycle Bin. Other local changes will be lost.'
        : 'The selected local changes will be lost.',
      confirmLabel: 'Discard',
    };
  }
  return {
    title: action.paths.length === 1 ? 'Delete item' : `Delete ${action.paths.length} items`,
    message: action.paths.length === 1
      ? 'Move this item to the Recycle Bin?'
      : `Move ${action.paths.length} items to the Recycle Bin?`,
    detail: action.paths.join('\n'),
    confirmLabel: 'Move to Recycle Bin',
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
