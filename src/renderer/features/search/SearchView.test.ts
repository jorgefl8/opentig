// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SearchView } from './SearchView';

const search = vi.hoisted(() => vi.fn());
vi.mock('@/lib/opentig-api', () => ({ opentig: { repository: { search, replaceSearch: vi.fn() } } }));

let root: Root;
let container: HTMLDivElement;
let mobile = false;
const onOpenFile = vi.fn();

function mount() {
  act(() => root.render(createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(TooltipProvider, null,
      createElement(SearchView, { repositoryId: 'sample', active: true, revision: 0, onOpenFile, unsavedPathsAmong: () => [], onReplaced: () => {} })))));
}

beforeEach(() => {
  mobile = false;
  onOpenFile.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }));
  search.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const replaceField = () => container.querySelector<HTMLInputElement>('input[aria-label="Replace with"]');
const menuItem = (text: string) => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((item) => item.textContent?.startsWith(text));

async function openMenu() {
  await act(async () => { button('More search options').click(); });
}

async function chooseFromMenu(text: string) {
  await act(async () => { menuItem(text)!.click(); });
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('reports each match option through aria-pressed', () => {
  for (const name of ['Match case', 'Match whole word', 'Use regular expression']) {
    expect(button(name).getAttribute('aria-pressed')).toBe('false');
    act(() => button(name).click());
    expect(button(name).getAttribute('aria-pressed')).toBe('true');
  }
});

it('keeps ignored files in the menu and off by default', async () => {
  await openMenu();
  const item = menuItem('Include ignored files')!;
  expect(item.getAttribute('aria-checked')).toBe('false');
  await chooseFromMenu('Include ignored files');
  expect(menuItem('Include ignored files')!.getAttribute('aria-checked')).toBe('true');
});

it('reveals the replace field from the menu and hides it again', async () => {
  expect(replaceField()).toBeNull();
  await openMenu();
  await chooseFromMenu('Replace…');
  expect(replaceField()).not.toBeNull();
  await openMenu();
  await chooseFromMenu('Hide replace');
  expect(replaceField()).toBeNull();
});

it('keeps the replace field visible while it holds a value', async () => {
  await openMenu();
  await chooseFromMenu('Replace…');
  type(replaceField()!, 'job');
  await openMenu();
  expect(menuItem('Hide replace')!.getAttribute('aria-disabled')).toBe('true');
  await chooseFromMenu('Hide replace');
  expect(replaceField()?.value).toBe('job');
});

describe('on a phone', () => {
  const sheetRow = (text: string) => [...document.querySelectorAll<HTMLElement>('.mobile-sheet .mobile-sheet-action')].find((row) => row.textContent?.startsWith(text));
  const openSheet = async () => { await act(async () => { button('More search options').click(); }); };
  beforeEach(() => {
    act(() => root.unmount());
    mobile = true;
    root = createRoot(container);
    mount();
  });

  it('keeps the match toggles in the field', () => {
    expect([...container.querySelectorAll('.search-input .search-toggles button')].map((toggle) => toggle.textContent)).toEqual(['Aa', 'ab', '.*']);
  });

  it('offers its options in a sheet rather than a menu', async () => {
    await openSheet();
    expect(document.querySelector('.mobile-sheet-title')?.textContent).toBe('Search');
    expect(document.querySelector('[role^="menuitem"]')).toBeNull();
    expect(sheetRow('Include ignored files')?.getAttribute('aria-checked')).toBe('false');
    await act(async () => sheetRow('Include ignored files')!.click());
    expect(sheetRow('Include ignored files')?.getAttribute('aria-checked')).toBe('true');
  });

  it('reveals the replace field from the sheet and hides it again', async () => {
    await openSheet();
    await act(async () => sheetRow('Replace…')!.click());
    expect(replaceField()).not.toBeNull();
    await openSheet();
    await act(async () => sheetRow('Hide replace')!.click());
    expect(replaceField()).toBeNull();
  });

  it('keeps the replace field while it holds a value, and says why', async () => {
    await openSheet();
    await act(async () => sheetRow('Replace…')!.click());
    type(replaceField()!, 'job');
    await openSheet();
    expect((sheetRow('Hide replace') as HTMLButtonElement).disabled).toBe(true);
    expect(sheetRow('Hide replace')?.textContent).toContain('Clear it first');
  });
});
