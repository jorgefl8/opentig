import { describe, expect, it } from 'vitest';
import { normalizePairingOrigin } from './web-access';

describe('pairing origins', () => {
  it.each([[' https://git.example.com/ ', 'https://git.example.com'], ['https://git.example.com:443', 'https://git.example.com'], ['http://127.0.0.1:6767/', 'http://127.0.0.1:6767'], ['http://[::1]:6767', 'http://[::1]:6767']])('normalizes %s', (input, expected) => {
    expect(normalizePairingOrigin(input)).toBe(expected);
  });
  it.each(['', 'git.example.com', 'ftp://git.example.com', 'https://user:secret@git.example.com', 'https://git.example.com/path', 'https://git.example.com?token=secret', 'https://git.example.com#token=secret', 'https://git.example.com?', 'https://git.example.com/#', 'https://git.example.com/..', 'https:git.example.com', 'https://git.example.com\\path', 'https://git.example.com /', 'x'.repeat(2_049)])('rejects invalid origin %s', (input) => {
    expect(() => normalizePairingOrigin(input)).toThrow();
  });
});
