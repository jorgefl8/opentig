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

async function showAccountOption(tooltip?: string) {
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
    groups: [{ id: 'accounts', label: 'Access', items: [{ value: 'existing', label: 'Use existing credentials', description: 'Keep the accounts already set up on this machine.', ...(tooltip ? { tooltip } : {}) }] }],
    value: 'existing', onValueChange, label: 'Account', triggerLabel: 'Use existing credentials', placeholder: 'Search accounts…', open: true,
  }))));
}

it.each([undefined, 'Use existing credentials · Keep the accounts already set up on this machine.'])('does not repeat fully visible account text in a tooltip (%s)', async tooltip => {
  await showAccountOption(tooltip);
  await hover('Use existing credentials');
  expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
  await act(async () => option('Use existing credentials').click());
  expect(document.querySelector('[role="combobox"]')).not.toBeNull();
});

it('shows truncated descriptions and dismisses the tooltip when a resize makes them fit', async () => {
  let truncated = true;
  const observers: Array<() => void> = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(element: Element) { if (element.classList.contains('searchable-picker-copy')) observers.push(this.callback); }
    unobserve() {} disconnect() {}
  });
  const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function(this: HTMLElement) {
    return this.tagName === 'SMALL' && truncated ? 200 : 100;
  });
  const available = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
  try {
    await showAccountOption();
    await hover('Use existing credentials');
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain('Keep the accounts already set up on this machine.');
    await act(async () => { truncated = false; observers.forEach(callback => callback()); });
    expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
  } finally { width.mockRestore(); available.mockRestore(); }
});

it.each([undefined, 'branch-picker'])('keeps a truncated trigger tooltip open until the dropdown opens (id: %s)', async triggerId => {
  const label = 'feat/ai-generation-isolation';
  const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(240);
  const available = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(160);
  try {
    await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
      key: 'branch', ...(triggerId ? { triggerId } : {}),
      groups: [{ id: 'branches', label: 'Branches', items: [{ value: label, label }] }],
      value: label, onValueChange, label: 'Select branch', triggerLabel: label, placeholder: 'Search branches…',
    }))));
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    expect(document.querySelector('[data-slot="tooltip-content"][data-open]')?.textContent).toBe(label);
    expect(trigger.querySelector('button')).toBeNull();
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
    expect(option(label)).toBeDefined();
  } finally { width.mockRestore(); available.mockRestore(); }
});
