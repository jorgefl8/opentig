// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OpenFilesStrip } from './OpenFilesStrip';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout; the strip scrolls the active tab into view.
  HTMLElement.prototype.scrollIntoView ??= () => undefined;
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('closes a tab with the wheel button without starting the browser\'s autoscroll first', async () => {
  const onClose = vi.fn();
  const tab = (path: string) => ({ path, pinned: true, dirty: false, missing: false, activatedAt: 0 });
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(OpenFilesStrip, {
    session: { tabs: [tab('src/a.ts'), tab('src/b.ts')], activePath: 'src/a.ts', previewPath: null, activationCounter: 0 },
    onActivate: vi.fn(), onPin: vi.fn(), onClose, onReorder: vi.fn(),
  }))));
  const second = container.querySelectorAll<HTMLElement>('[role="tab"]')[1]!;
  const press = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
  await act(async () => { second.dispatchEvent(press); });
  expect(press.defaultPrevented).toBe(true);
  const primaryPress = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
  await act(async () => { second.dispatchEvent(primaryPress); });
  expect(primaryPress.defaultPrevented).toBe(false);
  await act(async () => { second.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })); });
  expect(onClose).toHaveBeenCalledWith('src/b.ts');
});
