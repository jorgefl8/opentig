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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Lets pending tooltip and virtualizer timers run, in fake or real time. */
const flushTimers = () => vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(0) : new Promise(resolve => setTimeout(resolve, 0));

/** Re-renders the repository rows as cut short, the only case with a tooltip. */
async function truncateRows() {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
    key: 'truncated',
    groups: [{ id: 'repositories', label: 'Repositories', items: ['Atlas', 'Beacon'].map(name => ({ value: name, label: name, tooltip: `/sample/${name.toLowerCase()}` })) }],
    value: 'Atlas', onValueChange, label: 'Repository', triggerLabel: 'Atlas', placeholder: 'Search repositories…', open: true,
  }))));
}

async function hover(name: string) {
  await act(async () => {
    option(name).dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    option(name).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await flushTimers();
  });
}

it('has no tooltip on a row that shows all its text, however much more the tooltip would say', async () => {
  await hover('Beacon');
  expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
});

it('dismisses a hovered row tooltip on wheel input while keeping repository selection available', async () => {
  await truncateRows();
  await hover('Beacon');
  expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain('/sample/beacon');
  await act(async () => document.querySelector('.searchable-picker-list')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })));
  expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
  expect(option('Beacon').getAttribute('aria-disabled')).not.toBe('true');
  await act(async () => option('Beacon').click());
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith('Beacon');
});

it('suppresses tooltips during scrolling and allows them again after scrolling stops', async () => {
  await truncateRows();
  vi.useFakeTimers();
  try {
    await act(async () => document.querySelector('.searchable-picker-list')!.dispatchEvent(new Event('scroll')));
    expect(option('Beacon').hasAttribute('data-trigger-disabled')).toBe(true);
    await hover('Beacon');
    expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(option('Beacon').hasAttribute('data-trigger-disabled')).toBe(false);
    await hover('Beacon');
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain('/sample/beacon');
  } finally {
    // Close the picker on the fake clock, so nothing it scheduled there is left waiting once real time is back.
    await act(async () => root.unmount());
    await act(async () => { vi.runOnlyPendingTimers(); });
    vi.useRealTimers();
    root = createRoot(container);
  }
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
      await flushTimers();
    });
    expect(document.querySelector('[data-slot="tooltip-content"][data-open]')?.textContent).toBe(label);
    expect(trigger.querySelector('button')).toBeNull();
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-slot="tooltip-content"][data-open]')).toBeNull();
    expect(option(label)).toBeDefined();
  } finally { width.mockRestore(); available.mockRestore(); }
});

it('hints at the trigger even when its label fits, and adds the hint to a truncated label', async () => {
  const hover = async () => {
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      await flushTimers();
    });
    return document.querySelector('[data-slot="tooltip-content"][data-open]')?.textContent;
  };
  const picker = (key: string) => createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
    key, groups: [{ id: 'repositories', label: 'Repositories', items: [{ value: 'Atlas', label: 'Atlas' }] }],
    value: 'Atlas', onValueChange, label: 'Repository', triggerLabel: 'Atlas', triggerHint: 'Switch repository (Q)', placeholder: 'Search repositories…',
  }));
  await act(async () => root.render(picker('fits')));
  expect(await hover()).toBe('Switch repository (Q)');
  const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(240);
  const available = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(160);
  try {
    await act(async () => root.render(picker('truncated')));
    expect(await hover()).toBe('Atlas · Switch repository (Q)');
  } finally { width.mockRestore(); available.mockRestore(); }
});

it('offers every management action outside the listbox and closes before running it', async () => {
  const open = vi.fn(); const manage = vi.fn();
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
    key: 'actions', groups: [{ id: 'repositories', label: 'Repositories', items: [{ value: 'Atlas', label: 'Atlas' }] }],
    value: 'Atlas', onValueChange, label: 'Repository', triggerLabel: 'Atlas', placeholder: 'Search repositories…',
    management: [{ label: 'Open repository…', shortcut: 'Ctrl+O', onClick: open }, { label: 'Manage projects…', onClick: manage }],
  }))));
  const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  await act(async () => trigger.click());
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.searchable-picker-footer button')];
  expect(rows().map(row => row.textContent?.trim())).toEqual(['Open repository…Ctrl+O', 'Manage projects…']);
  expect(rows()[0]!.getAttribute('aria-keyshortcuts')).toBe('Control+O');
  expect(document.querySelector('[role="listbox"] .searchable-picker-footer')).toBeNull();
  await act(async () => rows()[1]!.click());
  expect(manage).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

function mockListLayout() {
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('searchable-picker-list')) return 292;
    if (this.hasAttribute('data-index')) return (this.querySelector('small') ? 42 : 32) + (this.querySelector('[data-slot="combobox-group-label"]') ? 23 : 2);
    return 32;
  });
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(340);
  // The virtualizer reads the scroll area's size from clientHeight.
  const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) { return this.offsetHeight; });
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
  return () => { height.mockRestore(); width.mockRestore(); clientHeight.mockRestore(); scrollHeight.mockRestore(); rect.mockRestore(); HTMLElement.prototype.scrollTo = previous; };
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
  await act(flushTimers);
}

it('bounds mounted options and reveals a distant selection among 1000 choices', async () => {
  const count = 1000;
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

it('focuses the search on opening, except on a phone, where that would open the keyboard', async () => {
  const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"]');
  // Base UI moves focus into the popup a frame after it opens.
  await act(() => vi.waitFor(() => expect(document.activeElement).toBe(input())));
  await act(async () => document.querySelector<HTMLButtonElement>('button[role="combobox"]')!.click());
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(SearchablePicker, {
    groups: [{ id: 'branches', label: 'Branches', items: [{ value: 'main', label: 'main' }] }],
    value: 'main', onValueChange, label: 'Branch', triggerLabel: 'main', placeholder: 'Search branches',
  }))));
  await act(async () => document.querySelector<HTMLButtonElement>('button[role="combobox"]')!.click());
  // Long enough for that frame to have passed.
  await act(() => new Promise(resolve => setTimeout(resolve, 100)));
  expect(input()).not.toBeNull();
  expect(document.activeElement).not.toBe(input());
});

it('does not pull the list back to the selection when the pointer leaves a row while scrolling', async () => {
  const restore = mockListLayout();
  try {
    await showLargePicker(1000);
    await act(flushTimers);
    const list = document.querySelector<HTMLElement>('.searchable-picker-list')!;
    const row = list.querySelector<HTMLElement>('[role="option"]')!;
    const pointer = (type: string, relatedTarget: EventTarget | null = null) => new MouseEvent(type, { bubbles: true, relatedTarget });
    await act(async () => { for (const type of ['pointerover', 'pointermove', 'mouseover', 'mousemove']) row.dispatchEvent(pointer(type)); });
    await act(flushTimers);
    await act(async () => { list.scrollTop = 500; list.dispatchEvent(new Event('scroll')); });
    await act(async () => { for (const type of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) row.dispatchEvent(pointer(type, document.body)); });
    await act(flushTimers);
    expect(list.scrollTop).toBe(500);
  } finally { restore(); }
});

it('keeps a distant highlighted row fully inside the padded list viewport', async () => {
  const restore = mockListLayout();
  try {
    await showLargePicker(1000);
    const row = option('Option 900').closest<HTMLElement>('[data-index]')!;
    const group = row.closest<HTMLElement>('[role="group"]')!;
    const list = document.querySelector<HTMLElement>('.searchable-picker-list')!;
    // The real list has 4px of padding, outside the positioned inner spacer.
    const top = 4 + Number.parseFloat(group.style.top) + Number.parseFloat(row.style.top) - list.scrollTop;
    expect(top).toBeGreaterThanOrEqual(4);
    expect(top + row.offsetHeight).toBeLessThanOrEqual(list.offsetHeight - 4);
  } finally { restore(); }
});
