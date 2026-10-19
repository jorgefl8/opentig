// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../../../main/persistence/SettingsStore';
import { ShortcutsSettings } from './ShortcutsSettings';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount({ desktop }: { desktop: boolean }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  if (desktop) vi.stubGlobal('opentigDesktop', {});
  const onPreference = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const preferences = new SettingsStore('unused-settings.json').preferences;
  await act(async () => root.render(createElement(ShortcutsSettings, { preferences, onPreference })));
  const row = (label: string) => [...container.querySelectorAll('.shortcuts-row')].find((item) => item.querySelector('strong')?.textContent === label) as HTMLElement;
  return { container, onPreference, row };
}

describe('shortcut settings in a browser', () => {
  it('omits the desktop-only global shortcut and flags combos the browser keeps', async () => {
    const view = await mount({ desktop: false });
    expect(view.container.querySelector('[role="switch"]')).toBeNull();
    expect(view.container.textContent).not.toContain('double-tap Control');
    expect(view.container.textContent).toContain('Changes also apply to the desktop app.');
    expect(view.row('Close tab').textContent).toContain('Your browser keeps Ctrl + W.');
    expect(view.row('Next tab').textContent).toContain('Your browser keeps Ctrl + Tab.');
    expect(view.row('Save file').querySelector('.shortcuts-browser-note')).toBeNull();
  });

  it('refuses to assign a combo the browser keeps', async () => {
    const view = await mount({ desktop: false });
    const recorder = view.row('Save file').querySelector('.shortcut-recorder-button') as HTMLButtonElement;
    await act(async () => recorder.click());
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true })); });
    expect(view.onPreference).not.toHaveBeenCalled();
    expect(view.row('Save file').textContent).toContain('Your browser keeps Ctrl + T for itself.');
  });
});

describe('shortcut settings in the desktop app', () => {
  it('keeps the global shortcut and every combo available', async () => {
    const view = await mount({ desktop: true });
    expect(view.container.querySelector('[role="switch"]')).not.toBeNull();
    expect(view.container.textContent).toContain('double-tap Control');
    expect(view.container.querySelector('.shortcuts-browser-note')).toBeNull();
    const recorder = view.row('Save file').querySelector('.shortcut-recorder-button') as HTMLButtonElement;
    await act(async () => recorder.click());
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true })); });
    expect(view.onPreference).toHaveBeenCalledWith({ shortcutOverrides: { saveFile: 'Ctrl+T' } });
  });
});
