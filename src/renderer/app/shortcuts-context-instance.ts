import { createContext } from 'react';
import { DEFAULT_SHORTCUT_MAP, type ShortcutMap } from '@shared/shortcuts';

export const ShortcutsContext = createContext<ShortcutMap>(DEFAULT_SHORTCUT_MAP);
