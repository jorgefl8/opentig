import { describe, expect, it, vi } from 'vitest';
import type { WriteFileResult } from '@shared/contracts';
import { executeEditableFileSave, handleEditableFileSaveShortcut } from './useEditableFileDraft';

describe('executeEditableFileSave', () => {
  it('does not claim or persist clean, read-only or already-saving drafts', async () => {
    const persist = vi.fn<() => Promise<WriteFileResult>>();
    const clean = fixture({ dirty: false, persist });
    const readOnly = fixture({ readOnly: true, persist });
    const busy = fixture({ claim: () => false, persist });

    await expect(executeEditableFileSave(clean.options)).resolves.toBe('skipped');
    await expect(executeEditableFileSave(readOnly.options)).resolves.toBe('skipped');
    await expect(executeEditableFileSave(busy.options)).resolves.toBe('skipped');
    expect(persist).not.toHaveBeenCalled();
    expect(clean.release).not.toHaveBeenCalled();
  });

  it('reports success and releases the save claim', async () => {
    const current = fixture({ persist: async () => ({ status: 'saved', path: 'file.txt', size: 4, mtimeMs: 1 }) });
    await expect(executeEditableFileSave(current.options)).resolves.toBe('saved');
    expect(current.onSuccess).toHaveBeenCalledOnce();
    expect(current.onConflict).not.toHaveBeenCalled();
    expect(current.release).toHaveBeenCalledOnce();
  });

  it('reports conflicts and errors without changing the draft input', async () => {
    const conflict = fixture({ persist: async () => ({ status: 'conflict' }) });
    await expect(executeEditableFileSave(conflict.options)).resolves.toBe('conflict');
    expect(conflict.onConflict).toHaveBeenCalledOnce();
    expect(conflict.release).toHaveBeenCalledOnce();

    const reason = new Error('disk failed');
    const failed = fixture({ persist: async () => { throw reason; } });
    await expect(executeEditableFileSave(failed.options)).resolves.toBe('error');
    expect(failed.onError).toHaveBeenCalledWith(reason);
    expect(failed.release).toHaveBeenCalledOnce();
  });

  it('allows only one in-flight save', async () => {
    let claimed = false;
    let finish!: (value: WriteFileResult) => void;
    const persist = vi.fn(() => new Promise<WriteFileResult>((resolve) => { finish = resolve; }));
    const current = fixture({
      claim: () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      release: () => { claimed = false; },
      persist,
    });

    const first = executeEditableFileSave(current.options);
    await expect(executeEditableFileSave(current.options)).resolves.toBe('skipped');
    expect(persist).toHaveBeenCalledOnce();
    finish({ status: 'saved', path: 'file.txt', size: 4, mtimeMs: 1 });
    await expect(first).resolves.toBe('saved');
  });
});

describe('handleEditableFileSaveShortcut', () => {
  it('prevents Ctrl/Cmd+S and ignores unrelated keys', () => {
    const save = vi.fn();
    const ctrl = { ctrlKey: true, metaKey: false, key: 'S', preventDefault: vi.fn() };
    const meta = { ctrlKey: false, metaKey: true, key: 's', preventDefault: vi.fn() };
    const unrelated = { ctrlKey: true, metaKey: false, key: 'f', preventDefault: vi.fn() };

    expect(handleEditableFileSaveShortcut(ctrl, save)).toBe(true);
    expect(handleEditableFileSaveShortcut(meta, save)).toBe(true);
    expect(handleEditableFileSaveShortcut(unrelated, save)).toBe(false);
    expect(ctrl.preventDefault).toHaveBeenCalledOnce();
    expect(meta.preventDefault).toHaveBeenCalledOnce();
    expect(unrelated.preventDefault).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

function fixture(overrides: Partial<Parameters<typeof executeEditableFileSave>[0]> = {}) {
  const release = vi.fn();
  const onConflict = vi.fn();
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const options: Parameters<typeof executeEditableFileSave>[0] = {
    dirty: true,
    readOnly: false,
    claim: () => true,
    release,
    persist: async (): Promise<WriteFileResult> => ({ status: 'saved', path: 'file.txt', size: 4, mtimeMs: 1 }),
    onConflict,
    onSuccess,
    onError,
    ...overrides,
  };
  return {
    release,
    onConflict,
    onSuccess,
    onError,
    options,
  };
}
