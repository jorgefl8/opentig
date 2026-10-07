// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from './ui/tooltip';
import { SearchablePicker } from './SearchablePicker';

let root: Root;
let container: HTMLDivElement;
const onValueChange = vi.fn();
const option = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(item => item.textContent?.includes(name))!;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
    groups: [{ id: 'repositories', label: 'Repositories', items: ['Atlas', 'Beacon'].map(name => ({ value: name, label: name, tooltip: `/sample/${name.toLowerCase()}` })) }],
    value: 'Atlas', onValueChange, label: 'Repository', triggerLabel: 'Atlas', placeholder: 'Search repositories…',
  }))));
  await act(async () => document.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

async function hover(name: string) {
  await act(async () => {
    option(name).dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    option(name).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
  });
}

it('dismisses a hovered row tooltip on wheel input while keeping repository selection available', async () => {
  await hover('Beacon');
  expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain('/sample/beacon');
  await act(async () => document.querySelector('.searchable-picker-list')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })));
  expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
  expect(option('Beacon').getAttribute('aria-disabled')).not.toBe('true');
  await act(async () => option('Beacon').click());
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith('Beacon');
});

it('suppresses tooltips during scrolling and allows them again after scrolling stops', async () => {
  await act(async () => document.querySelector('.searchable-picker-list')!.dispatchEvent(new Event('scroll')));
  expect(option('Beacon').hasAttribute('data-trigger-disabled')).toBe(true);
  await hover('Beacon');
  expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(option('Beacon').hasAttribute('data-trigger-disabled')).toBe(false);
  await hover('Beacon');
  expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain('/sample/beacon');
});
