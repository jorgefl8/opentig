import { useSyncExternalStore } from 'react';

// Keep in sync with the phone breakpoint in styles/mobile.css.
const query = '(max-width: 767px)';
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const getSnapshot = () => window.matchMedia(query).matches;

export function useMobileLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
