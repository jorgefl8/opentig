import { describe, expect, it, vi } from 'vitest';
import { importWithRetry, isModuleLoadError } from './lazy-with-retry';

describe('isModuleLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://example.invalid/assets/PierreDiffViewer-C3j-CXjN.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://example.invalid/assets/a.js',
    'Unable to preload CSS for /assets/a.css',
  ])('recognises %s', (message) => {
    expect(isModuleLoadError(new TypeError(message))).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});

describe('importWithRetry', () => {
  const dropped = () => new TypeError('Importing a module script failed.');

  it('tries a dropped download again', async () => {
    const load = vi.fn().mockRejectedValueOnce(dropped()).mockResolvedValue('module');
    await expect(importWithRetry(load, [0, 0])).resolves.toBe('module');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('gives up after its retries, with the last error', async () => {
    const load = vi.fn().mockRejectedValue(dropped());
    await expect(importWithRetry(load, [0, 0])).rejects.toThrow('Importing a module script failed.');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not retry an error inside the module', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(importWithRetry(load, [0, 0])).rejects.toThrow('boom');
    expect(load).toHaveBeenCalledOnce();
  });
});
