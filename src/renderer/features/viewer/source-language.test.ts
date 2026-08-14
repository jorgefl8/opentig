import { describe, expect, it } from 'vitest';
import { sourceLanguage } from './source-language';

describe('sourceLanguage', () => {
  it('maps common source extensions and special filenames', () => {
    expect(sourceLanguage('src/App.tsx')).toBe('tsx');
    expect(sourceLanguage('scripts/build.ps1')).toBe('powershell');
    expect(sourceLanguage('Dockerfile')).toBe('docker');
    expect(sourceLanguage('config.yaml')).toBe('yaml');
  });

  it('uses plain text for unknown or extensionless files', () => {
    expect(sourceLanguage('LICENSE')).toBe('text');
    expect(sourceLanguage('data.custom')).toBe('text');
  });
});
