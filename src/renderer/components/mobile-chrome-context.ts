import { createContext, useContext } from 'react';

/**
 * Where a viewer on a phone puts its title, its actions and its one floating action.
 * All three are null while the viewer pane is hidden, so a viewer kept mounted behind
 * a list adds nothing to the screen.
 */
export interface MobileChromeHosts {
  title: HTMLElement | null;
  actions: HTMLElement | null;
  float: HTMLElement | null;
}

export const NO_MOBILE_CHROME_HOSTS: MobileChromeHosts = { title: null, actions: null, float: null };

/** Null above the phone layout. */
export const MobileChromeContext = createContext<MobileChromeHosts | null>(null);

export const useMobileChrome = () => useContext(MobileChromeContext);
