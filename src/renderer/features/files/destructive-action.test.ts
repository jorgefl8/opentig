import { describe, expect, it, vi } from 'vitest';
import type { FileChange, FileTreeEntry } from '../../../shared/git-types';
import {
  createDeleteAction,
  createDiscardAction,
  destructiveActionCopy,
  dispatchDestructiveAction,
} from './destructive-action';

const change = (path: string, kind: FileChange['kind']): FileChange => ({
  path,
  kind,
  indexStatus: ' ',
  worktreeStatus: '?',
  staged: false,
  unstaged: true,
  conflict: false,
  submodule: '',
});

const entry = (path: string): FileTreeEntry => ({ path, name: path, type: 'file', size: 1, mtimeMs: 0 });

describe('destructive file actions', () => {
  it('preserves discard warning copy for untracked files', () => {
    const action = createDiscardAction('repo', ['new.txt', 'tracked.txt'], [
      change('new.txt', 'untracked'),
      change('tracked.txt', 'modified'),
    ]);

    expect(destructiveActionCopy(action)).toEqual({
      title: 'Discard changes',
      message: 'Discard changes to these 2 files?',
      detail: 'Untracked files will be moved to system Trash. Other local changes will be lost.',
      confirmLabel: 'Discard',
    });
  });

  it('preserves batch deletion copy and path details', () => {
    const action = createDeleteAction('repo', [entry('one.txt'), entry('folder/two.txt')]);

    expect(destructiveActionCopy(action)).toEqual({
      title: 'Delete 2 items',
      message: 'Move 2 items to system Trash?',
      detail: 'one.txt\nfolder/two.txt',
      confirmLabel: 'Move to Trash',
    });
  });

  it('sends no mutation on cancel and exactly one on confirm', async () => {
    const discard = vi.fn(async () => ({ ok: true as const }));
    const deleteEntries = vi.fn(async () => ({ deleted: 1 as const, recovery: 'undo' as const }));
    const commands = { discard, deleteEntries };
    const action = createDeleteAction('repo', [entry('one.txt')]);

    await expect(dispatchDestructiveAction(action, false, commands)).resolves.toBeNull();
    expect(discard).not.toHaveBeenCalled();
    expect(deleteEntries).not.toHaveBeenCalled();

    await expect(dispatchDestructiveAction(action, true, commands)).resolves.toEqual({
      kind: 'delete', result: { deleted: 1, recovery: 'undo' },
    });
    expect(deleteEntries).toHaveBeenCalledOnce();
    expect(deleteEntries).toHaveBeenCalledWith('repo', ['one.txt']);
  });

  it('sends exactly one discard mutation on confirm', async () => {
    const discard = vi.fn(async () => ({ ok: true as const }));
    const deleteEntries = vi.fn(async () => ({ deleted: 0 as const, recovery: 'system-trash' as const }));
    const action = createDiscardAction('repo', ['tracked.txt'], [change('tracked.txt', 'modified')]);

    await expect(dispatchDestructiveAction(action, true, { discard, deleteEntries })).resolves.toEqual({
      kind: 'discard',
    });
    expect(discard).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledWith('repo', ['tracked.txt']);
    expect(deleteEntries).not.toHaveBeenCalled();
  });
});
