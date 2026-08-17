import type { PropsWithChildren } from 'react';
import type { ShortcutMap } from '@shared/shortcuts';
import { ShortcutsContext } from './shortcuts-context-instance';

export function ShortcutsProvider({ shortcuts, children }: PropsWithChildren<{ shortcuts: ShortcutMap }>) {
  return <ShortcutsContext.Provider value={shortcuts}>{children}</ShortcutsContext.Provider>;
}
