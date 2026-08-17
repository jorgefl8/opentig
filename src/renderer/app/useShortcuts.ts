import { useContext } from 'react';
import type { ShortcutMap } from '@shared/shortcuts';
import { ShortcutsContext } from './shortcuts-context-instance';

export function useShortcuts(): ShortcutMap {
  return useContext(ShortcutsContext);
}
