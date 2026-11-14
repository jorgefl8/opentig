// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Spinner } from './spinner';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.unstubAllGlobals();
});

async function render(props: ComponentProps<typeof Spinner> = {}) {
  await act(async () => root.render(createElement(Spinner, props)));
  return host.querySelector('svg')!;
}

it('turns one group about the center of its viewBox and leaves the svg element still', async () => {
  const svg = await render();
  // Nothing on the element itself: a class or style here is what would rotate it.
  expect(svg.hasAttribute('class')).toBe(false);
  expect(svg.hasAttribute('style')).toBe(false);
  expect(svg.hasAttribute('transform')).toBe(false);

  const groups = [...svg.querySelectorAll('g')];
  expect(groups.map((group) => group.getAttribute('class'))).toEqual(['spinner-arc']);
  expect(groups[0]!.querySelector('path')).not.toBeNull();
  // The faint ring is the still reference the arc turns over.
  expect(svg.querySelector(':scope > circle')).not.toBeNull();

  // The stylesheet turns that group about 12px 12px, the center of this viewBox.
  expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  const stylesheet = readFileSync(path.join(process.cwd(), 'src/renderer/styles/index.css'), 'utf8');
  expect(stylesheet).toMatch(/\.spinner-arc \{ transform-origin: 12px 12px; animation: spin 1s linear infinite; \}/);
});

it('takes the classes and attributes an icon would, adding none of its own', async () => {
  // Buttons size the icons whose class has no `size-`, so a class added here could change the size.
  const svg = await render({ className: 'size-5 text-primary', 'data-icon': 'inline-start' } as ComponentProps<typeof Spinner>);
  expect(svg.getAttribute('class')).toBe('size-5 text-primary');
  expect(svg.getAttribute('data-icon')).toBe('inline-start');
});

it('is decorative unless it is given a label', async () => {
  const decorative = await render();
  expect(decorative.getAttribute('aria-hidden')).toBe('true');
  expect(decorative.hasAttribute('role')).toBe(false);

  const labelled = await render({ label: 'Refreshing' });
  expect(labelled.getAttribute('role')).toBe('img');
  expect(labelled.getAttribute('aria-label')).toBe('Refreshing');
  expect(labelled.hasAttribute('aria-hidden')).toBe(false);
});
