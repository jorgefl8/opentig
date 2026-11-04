// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsStore } from '../../../main/persistence/SettingsStore';
import { GeneralSettings } from './GeneralSettings';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('opens the text preview from its own row', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(GeneralSettings, { preferences: new SettingsStore('unused-settings.json').preferences, onPreference: vi.fn() })));
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Text preview"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.settings-preview')).toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.settings-preview code')?.textContent).toContain('files.filter');
  } finally {
    await act(async () => root.unmount());
  }
});

it('shows readable saved font names before their menus are opened', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(GeneralSettings, {
      preferences: { ...new SettingsStore('unused-settings.json').preferences, uiFont: 'space-grotesk', monoFont: 'departure', remoteFetchIntervalSeconds: 45 },
      onPreference: vi.fn(),
    })));
    expect(container.querySelector('[aria-label="Interface font"]')?.textContent).toContain('Space Grotesk');
    expect(container.querySelector('[aria-label="Code font"]')?.textContent).toContain('Departure Mono');
    expect(container.querySelector('[aria-label="Remote check interval"]')?.textContent).toContain('45 seconds');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
