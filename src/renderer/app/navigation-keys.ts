import { createContext, useContext } from 'react';
import { navigationKeys, type NavigationKeys } from '@shared/shortcuts';

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Outside the app (the start screen's Settings): the browser's own keys in a browser, the app's on the desktop. */
const NavigationKeysContext = createContext<NavigationKeys>(navigationKeys(typeof window !== 'undefined' && !window.opentigDesktop, isMacPlatform()));

export const NavigationKeysProvider = NavigationKeysContext.Provider;

export function useNavigationKeys(): NavigationKeys {
  return useContext(NavigationKeysContext);
}
