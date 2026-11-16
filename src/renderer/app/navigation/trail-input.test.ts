// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForTrailInput } from './trail-input';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
});

function listen(canGoBack: boolean, canGoForward: boolean) {
  const trail = { state: () => ({ canGoBack, canGoForward }), back: vi.fn(), forward: vi.fn() };
  cleanups.push(listenForTrailInput(trail, false));
  return trail;
}

/** Releases a mouse button, and says whether the page kept the browser from acting on it. */
function release(button: number): boolean {
  const event = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('the mouse’s side buttons on a trail kept in memory', () => {
  it('walk the trail when there is a step that way', () => {
    const trail = listen(true, true);
    expect(release(3)).toBe(true);
    expect(release(4)).toBe(true);
    expect(trail.back).toHaveBeenCalledOnce();
    expect(trail.forward).toHaveBeenCalledOnce();
  });

  it('leave the button to the browser at either end of the trail', () => {
    const trail = listen(false, false);
    expect(release(3)).toBe(false);
    expect(release(4)).toBe(false);
    expect(trail.back).not.toHaveBeenCalled();
    expect(trail.forward).not.toHaveBeenCalled();
  });

  it('do nothing while a dialog or a menu is open', () => {
    for (const markup of ['<div data-slot="dialog-popup"></div>', '<div role="menu"></div>']) {
      document.body.innerHTML = markup;
      const trail = listen(true, true);
      expect(release(3), markup).toBe(false);
      expect(trail.back, markup).not.toHaveBeenCalled();
    }
  });
});
