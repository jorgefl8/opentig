import { expect, it } from 'vitest';
import { pairedDestination, rememberReturnAddress } from './pairing';

const memory = () => {
  const values = new Map<string, string>();
  return { setItem: (key: string, value: string) => void values.set(key, value), getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => void values.delete(key) };
};

it('returns to the app address a browser was opened on once it is paired, and only once', () => {
  const storage = memory();
  rememberReturnAddress({ pathname: '/r/r1/pr/24/code', search: '', hash: '' }, storage);
  expect(pairedDestination('https://opentig.test', storage)).toBe('/r/r1/pr/24/code');
  expect(pairedDestination('https://opentig.test', storage)).toBe('/');
});

it('never sends a paired browser anywhere but one of the app’s own addresses', () => {
  for (const kept of ['//evil.test/r/x', '/r/../../evil', 'https://evil.test/r/x', '/pair', '/\\evil.test']) {
    const storage = memory();
    storage.setItem('opentig.pairing.return', kept);
    const destination = pairedDestination('https://opentig.test', storage);
    expect(destination === '/' || destination.startsWith('/r/'), kept).toBe(true);
    expect(new URL(destination, 'https://opentig.test').origin, kept).toBe('https://opentig.test');
  }
  const ignored = memory();
  rememberReturnAddress({ pathname: '/settings', search: '', hash: '' }, ignored);
  expect(pairedDestination('https://opentig.test', ignored)).toBe('/');
});
