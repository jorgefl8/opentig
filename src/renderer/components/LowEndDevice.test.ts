// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isLowEndDevice } from '@/lib/low-end-device';
import { LowEndDevice } from './LowEndDevice';

const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 6a) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

it('marks Android phones with 4 GB of memory or less, or 4 cores or less', () => {
  expect(isLowEndDevice({ userAgent: android, deviceMemory: 4, hardwareConcurrency: 8 })).toBe(true);
  expect(isLowEndDevice({ userAgent: android, deviceMemory: 8, hardwareConcurrency: 4 })).toBe(true);
  expect(isLowEndDevice({ userAgent: android, deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
});

it('assumes a capable Android phone when it reports neither memory nor cores', () => {
  expect(isLowEndDevice({ userAgent: android })).toBe(false);
  expect(isLowEndDevice({ userAgent: android, hardwareConcurrency: 0 })).toBe(false);
  expect(isLowEndDevice({ userAgent: android, deviceMemory: 2 })).toBe(true);
});

it('never marks anything other than Android', () => {
  expect(isLowEndDevice({ userAgent: iphone, deviceMemory: 2, hardwareConcurrency: 2 })).toBe(false);
});

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => vi.unstubAllGlobals());

it('sets and clears the mark on the root element', async () => {
  vi.stubGlobal('navigator', { userAgent: android, hardwareConcurrency: 4 });
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(createElement(LowEndDevice)));
  expect(document.documentElement.dataset.lowEnd).toBe('');
  await act(async () => root.unmount());
  expect(document.documentElement.dataset.lowEnd).toBeUndefined();
});
