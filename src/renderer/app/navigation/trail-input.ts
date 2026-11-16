import { isEditableTarget } from '@/features/files/file-tree';
import type { NavigationTrail } from './trail';

/**
 * Alt+Left and Alt+Right, and the mouse's side buttons, for a trail kept in
 * memory (the desktop app and the website demo), where nothing else answers them.
 */
export function listenForTrailInput(trail: Pick<NavigationTrail, 'state' | 'back' | 'forward'>, mac: boolean): () => void {
  /** Takes a step and keeps the browser from acting, only when there is one that way and nothing covers the app. */
  const walk = (event: Event, back: boolean) => {
    if (document.querySelector('[data-slot="dialog-popup"], .mobile-sheet, [role="menu"], [role="listbox"]')) return;
    if (back ? !trail.state().canGoBack : !trail.state().canGoForward) return;
    event.preventDefault();
    if (back) trail.back(); else trail.forward();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    // On a Mac, Option with an arrow moves the caret by word.
    if (mac && isEditableTarget(event.target)) return;
    walk(event, event.key === 'ArrowLeft');
  };
  // The mouse's side buttons; at either end of the trail they stay the browser's.
  const onMouseUp = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) walk(event, event.button === 3);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('mouseup', onMouseUp);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('mouseup', onMouseUp);
  };
}
