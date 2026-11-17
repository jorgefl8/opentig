// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RefreshIcon } from './refresh-icon';

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

it('turns the arrows inside the icon about its center while turning, and leaves the svg element still', async () => {
  await act(async () => root.render(createElement(RefreshIcon, { turning: true })));
  const svg = host.querySelector('svg')!;
  expect(svg.hasAttribute('class')).toBe(false);
  expect(svg.hasAttribute('style')).toBe(false);
  expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  const group = svg.querySelector(':scope > g')!;
  expect(group.getAttribute('class')).toBe('refresh-icon-turn');
  expect(group.querySelectorAll('path')).toHaveLength(2);
  const stylesheet = readFileSync(path.join(process.cwd(), 'src/renderer/styles/index.css'), 'utf8');
  expect(stylesheet).toMatch(/\.refresh-icon-turn \{ transform-origin: 12px 12px; animation: spin 1s linear infinite; \}/);

  await act(async () => root.render(createElement(RefreshIcon, { turning: false })));
  expect(svg.querySelector(':scope > g')!.hasAttribute('class')).toBe(false);
});
