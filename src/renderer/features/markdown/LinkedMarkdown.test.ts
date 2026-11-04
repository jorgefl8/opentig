// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RepositoryLinksContext } from '@/components/repository-links';
import { LinkedMarkdown } from './LinkedMarkdown';
import { renderMarkdown } from './render-markdown';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(content: string) {
  const html = await renderMarkdown(content);
  await act(async () => root.render(createElement(TooltipProvider, { delay: 0 }, createElement(LinkedMarkdown, { html }))));
}

it('keeps Markdown labels and images while web and email links use separate browsing contexts', async () => {
  await render('[**Docs**](https://example.com/docs "Native tooltip") [![Badge](https://example.com/badge.png)](//example.com) [Mail](mailto:sample@example.invalid) [Footnote](#note)');
  const links = container.querySelectorAll<HTMLAnchorElement>('a');
  expect(links).toHaveLength(4);
  expect(links[0]!.querySelector('strong')?.textContent).toBe('Docs');
  expect(links[1]!.querySelector('img')?.alt).toBe('Badge');
  for (const link of [...links].slice(0, 3)) {
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.hasAttribute('title')).toBe(false);
  }
  expect(links[1]!.href).toBe('https://example.com/');
  expect(links[3]!.getAttribute('href')).toBe('#note');
  expect(links[3]!.target).toBe('');
});

it('shows the action and destination on keyboard focus and updates links when the description changes', async () => {
  await render('[Docs](https://example.com/docs)');
  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.focus());
  await act(async () => { await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Open in new tab')); });
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('https://example.com/docs');
  await render('[Mail](mailto:sample@example.invalid)');
  expect(container.querySelectorAll('a')).toHaveLength(1);
  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.focus());
  await act(async () => { await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Open in mail app')); });
});

it('never makes unsafe links interactive', async () => {
  await render('[Unsafe](javascript:alert%281%29)');
  expect(container.querySelector('[target="_blank"]')).toBeNull();
  expect(container.innerHTML).not.toContain('javascript:');
});

it("asks where to open links into the open repository, and leaves the rest as links", async () => {
  const open = vi.fn();
  const openExternal = vi.spyOn(window, 'open').mockReturnValue(null);
  const html = await renderMarkdown('[**#65**](https://github.com/sample/demo/pull/65) [v1](https://github.com/sample/demo/releases/tag/v1) [other](https://github.com/other/demo/pull/1)');
  await act(async () => root.render(createElement(RepositoryLinksContext.Provider, { value: { nameWithOwner: 'sample/demo', open } }, createElement(TooltipProvider, { delay: 0 }, createElement(LinkedMarkdown, { html })))));
  const references = container.querySelectorAll<HTMLButtonElement>('button.repository-link');
  expect(references).toHaveLength(2);
  expect(references[0]!.querySelector('strong')?.textContent).toBe('#65');
  expect(container.querySelectorAll('a')).toHaveLength(1);
  await act(async () => references[1]!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const item = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent?.includes(label))!;
  expect(document.body.textContent).toContain('Release v1');
  await act(async () => item('Open in OpenTig').click());
  expect(open).toHaveBeenCalledWith({ kind: 'release', tag: 'v1' });
  openExternal.mockRestore();
});

it('scrolls a `#section` link\'s pane to its heading instead of changing the page address', async () => {
  await render('[Jump](#later-section)\n\n## Later section');
  const pane = container.querySelector<HTMLElement>('.markdown-prose')!;
  // jsdom has no layout, so the text's box stands in for a scrolled pane.
  pane.style.overflowY = 'auto';
  Object.defineProperty(pane, 'scrollHeight', { value: 2000 });
  Object.defineProperty(pane, 'clientHeight', { value: 400 });
  const scrollTo = vi.fn();
  pane.scrollTo = scrollTo;
  const link = container.querySelector<HTMLAnchorElement>('a[href="#later-section"]')!;
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => { link.dispatchEvent(click); });
  expect(click.defaultPrevented).toBe(true);
  expect(scrollTo).toHaveBeenCalledOnce();
});
