import { describe, expect, it } from 'vitest';
import { buildFileEditorKeymap, OPENTIG_FILE_EDITOR_KEYMAP } from './source-editor-keymap';

describe('OPENTIG_FILE_EDITOR_KEYMAP', () => {
  it('only opens search and replace with Ctrl/Cmd+F on every platform', () => {
    expect(OPENTIG_FILE_EDITOR_KEYMAP).toEqual([{ bindings: { 'cmdOrCtrl+f': 'openSearchReplacePanel' } }]);
  });
});

describe('buildFileEditorKeymap', () => {
  it('converts a rebound combo into a Pierre binding', () => {
    expect(buildFileEditorKeymap('Ctrl+Shift+F')[0]!.bindings).toEqual({ 'cmdOrCtrl+shift+f': 'openSearchReplacePanel' });
  });
});
