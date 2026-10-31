// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from './use-long-press';

let root: Root;
let container: HTMLDivElement;
const onLongPress = vi.fn();
const onRowClick = vi.fn();
const onMainClick = vi.fn();
const onInnerClick = vi.fn();

function Row({ disabled = false }: { disabled?: boolean }) {
  const handlers = useLongPress(onLongPress, { disabled });
  return createElement('div', { className: 'row', onClick: onRowClick, ...handlers },
    createElement('button', { className: 'main', 'data-long-press-target': '', onClick: onMainClick }, 'File'),
    createElement('span', { className: 'letter' }, 'M'),
    createElement('button', { className: 'inner', onClick: onInnerClick }, '+'));
}

const part = (name: string) => container.querySelector<HTMLElement>(`.${name}`)!;

function pointer(type: string, target: HTMLElement, init: { x?: number; y?: number; pointerType?: string; button?: number; isPrimary?: boolean; pointerId?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 100, clientY: init.y ?? 100, button: init.button ?? 0 });
  Object.assign(event, { pointerType: init.pointerType ?? 'touch', isPrimary: init.isPrimary ?? true, pointerId: init.pointerId ?? 1 });
  act(() => { target.dispatchEvent(event); });
  return event;
}
const hold = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Row)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('holding a finger on a row', () => {
  it('fires once at about 450ms, on the row or on its main button', () => {
    for (const name of ['main', 'letter']) {
      onLongPress.mockClear();
      pointer('pointerdown', part(name));
      hold(449);
      expect(onLongPress).not.toHaveBeenCalled();
      hold(1);
      expect(onLongPress).toHaveBeenCalledOnce();
      hold(1000);
      expect(onLongPress).toHaveBeenCalledOnce();
      pointer('pointerup', part(name));
    }
  });

  it('leaves a press on an inner button to that button', () => {
    pointer('pointerdown', part('inner'));
    hold(1000);
    pointer('pointerup', part('inner'));
    act(() => part('inner').click());
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onInnerClick).toHaveBeenCalledOnce();
  });

  it('swallows the click that follows, and only that one', () => {
    pointer('pointerdown', part('main'));
    hold(450);
    pointer('pointerup', part('main'));
    act(() => part('main').click());
    expect(onMainClick).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
    act(() => part('main').click());
    expect(onMainClick).toHaveBeenCalledOnce();
  });

  it('forgets the swallowed click when none arrived, so a later key press still works', () => {
    pointer('pointerdown', part('main'));
    hold(450);
    pointer('pointerup', part('main'));
    hold(400);
    act(() => part('main').click());
    expect(onMainClick).toHaveBeenCalledOnce();
  });
});

describe('a normal tap', () => {
  it('runs the click and not the long press', () => {
    pointer('pointerdown', part('main'));
    hold(120);
    pointer('pointerup', part('main'));
    act(() => part('main').click());
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onMainClick).toHaveBeenCalledOnce();
  });
});

describe('cancelling', () => {
  it('stops after moving more than 10px, in any direction', () => {
    pointer('pointerdown', part('main'), { x: 100, y: 100 });
    pointer('pointermove', part('main'), { x: 100, y: 111 });
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    pointer('pointerdown', part('main'), { x: 100, y: 100 });
    pointer('pointermove', part('main'), { x: 90, y: 94 });
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('tolerates a finger that shifts a little', () => {
    pointer('pointerdown', part('main'), { x: 100, y: 100 });
    pointer('pointermove', part('main'), { x: 104, y: 106 });
    hold(450);
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it('stops when the browser takes the touch for scrolling', () => {
    pointer('pointerdown', part('main'));
    hold(100);
    pointer('pointercancel', part('main'));
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('stops when anything scrolls under the finger', () => {
    pointer('pointerdown', part('main'));
    act(() => { container.dispatchEvent(new Event('scroll')); });
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('stops for a second finger, and ignores one that starts second', () => {
    pointer('pointerdown', part('main'));
    pointer('pointerdown', part('letter'), { isPrimary: false, pointerId: 2 });
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('stops when the row goes away', () => {
    pointer('pointerdown', part('main'));
    act(() => root.render(createElement('div')));
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('other inputs', () => {
  it('ignores a held mouse button, so dragging across text still selects it', () => {
    pointer('pointerdown', part('main'), { pointerType: 'mouse' });
    hold(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('accepts a pen', () => {
    pointer('pointerdown', part('main'), { pointerType: 'pen' });
    hold(450);
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it('treats contextmenu as the same action and keeps the browser menu closed', () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { part('main').dispatchEvent(event); });
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves contextmenu on an inner button alone', () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { part('inner').dispatchEvent(event); });
    expect(onLongPress).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('runs once when Android follows the press with contextmenu', () => {
    pointer('pointerdown', part('main'));
    hold(450);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { part('main').dispatchEvent(event); });
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('runs once when contextmenu comes first, and swallows that press\'s click', () => {
    pointer('pointerdown', part('main'));
    hold(300);
    act(() => { part('main').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    hold(1000);
    expect(onLongPress).toHaveBeenCalledOnce();
    pointer('pointerup', part('main'));
    act(() => part('main').click());
    expect(onMainClick).not.toHaveBeenCalled();
  });

  it('keeps Enter working right after the menu key opened the action', () => {
    act(() => { part('main').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    act(() => part('main').click());
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(onMainClick).toHaveBeenCalledOnce();
  });
});

it('does nothing while disabled', () => {
  act(() => root.render(createElement(Row, { disabled: true })));
  pointer('pointerdown', part('main'));
  hold(1000);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => { part('main').dispatchEvent(event); });
  expect(onLongPress).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});
