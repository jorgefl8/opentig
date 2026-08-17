import type { EditorKeymap } from '@pierre/diffs/edit';

export const JUSTGIT_FILE_EDITOR_KEYMAP = [
  { bindings: { 'cmdOrCtrl+f': 'openSearchReplacePanel' } },
] satisfies EditorKeymap;
