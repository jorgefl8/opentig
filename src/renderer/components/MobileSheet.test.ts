// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileSheet } from './MobileSheet';

let root: Root;
let container: HTMLDivElement;
const changes = vi.fn();

function Harness({ description, keepOpen = false }: { description?: string; keepOpen?: boolean }) {
  const [open, setOpen] = useState(true);
  return createElement(MobileSheet, {
    open,
    onOpenChange: (next: boolean) => { changes(next); if (!keepOpen) setOpen(next); },
    title: 'Repository',
    description,
    children: createElement('button', { type: 'button' }, 'Refresh'),
  });
}
const render = async (props: Parameters<typeof Harness>[0] = {}) => { await act(async () => root.render(createElement(Harness, props))); };
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  changes.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('names the sheet after its title and only describes it when asked to', async () => {
  await render();
  const labelledBy = sheet()!.getAttribute('aria-labelledby');
  expect(document.getElementById(labelledBy!)?.textContent).toBe('Repository');
  expect(sheet()!.hasAttribute('aria-describedby')).toBe(false);
  await act(async () => root.unmount()); root = createRoot(container);
  await render({ description: 'src/filter-tasks.js' });
  await settle();
  expect(document.getElementById(sheet()!.getAttribute('aria-describedby')!)?.textContent).toBe('src/filter-tasks.js');
});

it('keeps its content and a drag handle, and a close control for keyboards and screen readers', async () => {
  await render();
  expect(sheet()!.querySelector('.mobile-sheet-handle')).not.toBeNull();
  expect(sheet()!.textContent).toContain('Refresh');
  const close = sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Close Repository"]')!;
  await act(async () => close.click());
  expect(changes).toHaveBeenCalledWith(false);
});

it('closes on Escape', async () => {
  await render();
  await settle();
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(changes).toHaveBeenCalledWith(false);
});

it('stays open when its owner refuses to close, as a move in progress does', async () => {
  await render({ keepOpen: true });
  await settle();
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(changes).toHaveBeenCalledWith(false);
  expect(sheet()).not.toBeNull();
});
