// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TrailButton, type TrailListItem } from './TrailMenu';

const steps: TrailListItem[] = [
  { key: 'one', offset: -1, name: { icon: 'history', title: 'History', detail: 'Section' } },
  { key: 'two', offset: -2, name: { icon: 'files', title: 'Files', detail: 'Section' } },
];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(createElement(TooltipProvider, null, createElement(TrailButton, {
    direction: 'back', enabled: true, keys: 'Alt+←', keysAria: 'Alt+ArrowLeft', onStep: () => undefined, listSteps: () => steps, onGo: () => undefined, children: 'Back',
  }))));
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const button = () => container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!;
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const settle = async () => { for (let tick = 0; tick < 10; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };
function contextMenu() {
  act(() => { button().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })); });
}

it('opens on its first step for the keyboard’s menu key, and not for a right button however long it is held', async () => {
  button().focus();
  const down = new MouseEvent('pointerdown', { bubbles: true, button: 2 });
  Object.assign(down, { pointerType: 'mouse', isPrimary: true, pointerId: 1 });
  act(() => { button().dispatchEvent(down); });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  contextMenu();
  await settle();
  expect(rows()).toHaveLength(2);
  expect(rows()).not.toContain(document.activeElement);
  act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await settle();
  expect(rows()).toHaveLength(0);

  button().focus();
  act(() => { button().dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); });
  contextMenu();
  await settle();
  expect(document.activeElement).toBe(rows()[0]);
});
