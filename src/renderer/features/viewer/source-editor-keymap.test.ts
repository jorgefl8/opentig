import { describe, expect, it } from 'vitest';
import { JUSTGIT_FILE_EDITOR_KEYMAP } from './source-editor-keymap';

describe('JUSTGIT_FILE_EDITOR_KEYMAP', () => {
  it('defines one platform-independent group', () => {
    expect(JUSTGIT_FILE_EDITOR_KEYMAP).toHaveLength(1);
    expect(JUSTGIT_FILE_EDITOR_KEYMAP[0]!).not.toHaveProperty('platform');
  });

  it('opens search and replace with Ctrl/Cmd+F', () => {
    expect(JUSTGIT_FILE_EDITOR_KEYMAP[0]!.bindings['cmdOrCtrl+f'])
      .toBe('openSearchReplacePanel');
  });

  it('does not override other shortcuts', () => {
    expect(Object.keys(JUSTGIT_FILE_EDITOR_KEYMAP[0]!.bindings))
      .toEqual(['cmdOrCtrl+f']);
  });
});
