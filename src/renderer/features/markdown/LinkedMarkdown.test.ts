// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
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
