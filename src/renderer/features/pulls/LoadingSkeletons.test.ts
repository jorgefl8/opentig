// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListSkeleton, ViewerSkeleton } from './LoadingSkeletons';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

/** The text of a region that assistive technology reads, leaving out what is hidden from it. */
function spokenText(region: Element): string {
  const walk = (node: Node): string => node instanceof Element && node.getAttribute('aria-hidden') === 'true' ? ''
    : node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : [...node.childNodes].map(walk).join('');
  return walk(region).replace(/​/g, '').trim();
}

it('speaks what is loading inside the region, as the spinner\'s text was, and hides the placeholder rows', async () => {
  await act(async () => root.render(createElement(ListSkeleton, { kind: 'run', label: 'Loading workflow runs' })));
  const list = host.querySelector('[role="status"]')!;
  expect(spokenText(list)).toBe('Loading workflow runs…');
  expect(list.querySelectorAll('.pull-item[aria-hidden="true"]').length).toBeGreaterThan(0);

  await act(async () => root.render(createElement(ViewerSkeleton, { bar: null, label: 'Loading release v1.2.0' })));
  expect(spokenText(host.querySelector('[role="status"]')!)).toBe('Loading release v1.2.0…');
});
