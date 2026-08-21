import { describe, expect, it } from 'vitest';
import { buildFileEditorKeymap, OPENTIG_FILE_EDITOR_KEYMAP } from './source-editor-keymap';

describe('OPENTIG_FILE_EDITOR_KEYMAP', () => {
  it('defines one platform-independent group', () => {
    expect(OPENTIG_FILE_EDITOR_KEYMAP).toHaveLength(1);
    expect(OPENTIG_FILE_EDITOR_KEYMAP[0]!).not.toHaveProperty('platform');
  });

  it('opens search and replace with Ctrl/Cmd+F', () => {
    expect(OPENTIG_FILE_EDITOR_KEYMAP[0]!.bindings['cmdOrCtrl+f'])
      .toBe('openSearchReplacePanel');
  });

  it('does not override other shortcuts', () => {
    expect(Object.keys(OPENTIG_FILE_EDITOR_KEYMAP[0]!.bindings))
      .toEqual(['cmdOrCtrl+f']);
  });
});

describe('buildFileEditorKeymap', () => {
  it('converts a rebound combo into a Pierre binding', () => {
    expect(buildFileEditorKeymap('Ctrl+Shift+F')[0]!.bindings).toEqual({ 'cmdOrCtrl+shift+f': 'openSearchReplacePanel' });
  });
});
