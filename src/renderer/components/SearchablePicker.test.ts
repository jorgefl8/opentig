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

function mockListLayout() {
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('searchable-picker-list')) return 292;
    if (this.hasAttribute('data-index')) return (this.querySelector('small') ? 42 : 32) + (this.querySelector('[data-slot="combobox-group-label"]') ? 23 : 2);
    return 32;
  });
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(340);
  const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('searchable-picker-list') ? Number.parseFloat((this.firstElementChild as HTMLElement)?.style.height ?? '0') : this.offsetHeight;
  });
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, right: 340, bottom: this.offsetHeight, width: 340, height: this.offsetHeight, toJSON() {} };
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { this.callback([{ target: element, borderBoxSize: [{ blockSize: (element as HTMLElement).offsetHeight, inlineSize: 340 }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {} disconnect() {}
  });
  const scrollTo = vi.fn(function(this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0;
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  });
  vi.stubGlobal('scrollTo', scrollTo);
  const previous = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = scrollTo;
  return () => { height.mockRestore(); width.mockRestore(); scrollHeight.mockRestore(); rect.mockRestore(); HTMLElement.prototype.scrollTo = previous; };
}

async function showLargePicker(count: number, value = 'item-900', open = true) {
  const items = Array.from({ length: count }, (_, index) => ({ value: `item-${index}`, label: `Option ${index}`, ...(index % 3 === 0 ? { description: 'Sample description' } : {}), disabled: index === 901 }));
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
    key: 'large', groups: [{ id: 'first', label: 'First group', items: items.slice(0, count / 2) }, { id: 'second', label: 'Second group', items: items.slice(count / 2) }],
    value, onValueChange, label: 'Sample selection', triggerLabel: value, placeholder: 'Search options',
  }))));
  if (open) await act(async () => document.querySelector<HTMLButtonElement>('button[role="combobox"]')!.click());
}

async function key(key: string) {
  await act(async () => {
    document.querySelector<HTMLInputElement>('input[role="combobox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}

it.each([1000, 3000])('bounds mounted options and reveals a distant selection among %i choices', async count => {
  const restore = mockListLayout();
  try {
    await showLargePicker(count);
    expect(document.querySelectorAll('[role="option"]').length).toBeLessThan(30);
    expect(option('Option 900').hasAttribute('data-selected')).toBe(true);
    const list = document.querySelector<HTMLElement>('.searchable-picker-list')!;
    expect(list.scrollTop).toBeGreaterThan(20_000);
    expect(option('Option 900').closest('[role="group"]')?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(option('Option 900').getAttribute('aria-setsize')).toBe(String(count));
    await act(async () => option('Option 902').click());
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('item-902');
  } finally { restore(); }
});

it('keeps keyboard descendants mounted, prevents disabled selection, and selects after scrolling away', async () => {
  const restore = mockListLayout();
  try {
    await showLargePicker(1000);
    await key('ArrowDown');
    await key('Enter');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(option('Option 901').getAttribute('aria-disabled')).toBe('true');
    await key('ArrowDown');
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    const activeId = input.getAttribute('aria-activedescendant')!;
    expect(document.getElementById(activeId)?.textContent).toContain('Option 902');
    await act(async () => {
      const list = document.querySelector<HTMLElement>('.searchable-picker-list')!;
      list.scrollTop = 0; list.dispatchEvent(new Event('scroll'));
    });
    expect(document.getElementById(activeId)?.textContent).toContain('Option 902');
    expect(document.querySelectorAll('[role="option"]').length).toBeLessThan(30);
    await key('Enter');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('item-902');
  } finally { restore(); }
});

it('filters virtual groups into an ordinary small menu without losing keyboard selection', async () => {
  const restore = mockListLayout();
  try {
    await showLargePicker(1000);
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Option 98');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(11);
    expect(document.querySelector('[role="group"]')?.textContent).toContain('First group');
    expect(document.querySelectorAll('[role="group"]')).toHaveLength(2);
    await key('ArrowDown');
    await key('Enter');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('item-98');
  } finally { restore(); }
});

it('navigates beyond the mounted buffer and wraps to a different group', async () => {
  const restore = mockListLayout();
  try {
    await showLargePicker(1000, 'item-980');
    for (let index = 981; index <= 999; index++) {
      await key('ArrowDown');
      const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
      expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toContain(`Option ${index}`);
      expect(document.querySelectorAll('[role="option"]').length).toBeLessThan(30);
    }
    // The ordinary combobox permits one unhighlighted step before wrapping.
    await key('ArrowDown'); await key('ArrowDown');
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    const active = document.getElementById(input.getAttribute('aria-activedescendant')!)!;
    expect(active.textContent).toContain('Option 0');
    const group = active.closest('[role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('First group');
    await key('Enter');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('item-0');
  } finally { restore(); }
});

it('preserves user scrolling when live groups refresh without a query or highlight change', async () => {
  const restore = mockListLayout();
  try {
    await showLargePicker(1000);
    const list = document.querySelector<HTMLElement>('.searchable-picker-list')!;
    await act(async () => { list.scrollTop = 15_000; list.dispatchEvent(new Event('scroll')); });
    const before = list.scrollTop;
    await showLargePicker(1000, 'item-900', false);
    expect(document.querySelector<HTMLElement>('.searchable-picker-list')!.scrollTop).toBe(before);
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toContain('Option 900');
  } finally { restore(); }
});
