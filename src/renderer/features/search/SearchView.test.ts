// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SearchView } from './SearchView';

const search = vi.hoisted(() => vi.fn());
vi.mock('@/lib/opentig-api', () => ({ opentig: { repository: { search, replaceSearch: vi.fn() } } }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  search.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(TooltipProvider, null,
      createElement(SearchView, { repositoryId: 'sample', active: true, revision: 0, onOpenFile: () => {}, unsavedPathsAmong: () => [], onReplaced: () => {} })))));
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
