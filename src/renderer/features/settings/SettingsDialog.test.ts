// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiHarnessStatus, Preferences } from '@shared/contracts';
import { SettingsStore } from '../../../main/persistence/SettingsStore';
import { SettingsDialog } from './SettingsDialog';

const { statuses, toastError } = vi.hoisted(() => ({ statuses: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { ai: { statuses }, events: { onAiInstructionsChanged: () => () => {}, onRepositoryChanged: () => () => {} } } }));
vi.mock('sileo', () => ({ sileo: { error: toastError } }));
vi.mock('motion/react', async (original) => ({ ...await original<typeof import('motion/react')>(), useReducedMotion: () => true }));

const saved: AiHarnessStatus[] = (['codex', 'claude', 'opencode', 'grok'] as const).map((id) => ({
  id, label: id, installed: true, availability: 'ready', authStatus: 'authenticated',
  version: 'saved-version', checkedAt: '2026-10-06T10:00:00.000Z', models: [{ id: 'default', label: 'Default' }, { id: 'saved-model', label: 'Saved model' }],
}));
afterEach(() => { vi.unstubAllGlobals(); });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  let root = createRoot(container);
  let preferences = new SettingsStore('unused-settings.json').preferences;
  const render = () => root.render(createElement(QueryClientProvider, { client }, createElement(SettingsDialog, {
    preferences, onPreference: vi.fn(), open: true, onOpenChange: vi.fn(), section: 'ai', onSectionChange: vi.fn(),
  })));
  await act(async () => { render(); await settle(); });
  await act(settle);
  return {
    client,
    preferences,
    dialog: () => document.querySelector('[role="dialog"]') as HTMLElement,
    rerender: async (next: Preferences) => { preferences = next; await act(async () => { render(); await settle(); }); await act(settle); },
    reopen: async () => {
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => { render(); await settle(); });
      await act(settle);
    },
    close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); },
  };
}
function checkButton(dialog: HTMLElement): HTMLButtonElement {
  return [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Check again'))!;
}

describe('saved AI assistance settings', () => {
  it('shows the saved date and models and reopens without a new status request', async () => {
    statuses.mockResolvedValue(saved);
    const view = await mount();
    try {
      expect(view.dialog().textContent).toContain('Last checked: 06/10/2026');
      expect(view.dialog().textContent).toContain('saved-version');
      await view.rerender({ ...view.preferences, commitMessageHarness: 'claude', commitMessageModels: { ...view.preferences.commitMessageModels, claude: 'saved-model' }, aiExecutablePaths: {} });
      expect(view.dialog().querySelector('[aria-label="Claude Code model"]')?.textContent).toContain('Saved model');
      await view.reopen();
      expect(statuses).toHaveBeenCalledExactlyOnceWith(false);
      expect(view.dialog().textContent).not.toContain('Checking…');
    } finally { await view.close(); }
  });

  it('retains saved results while explicitly checking again and then updates them', async () => {
    let release!: (value: AiHarnessStatus[]) => void;
    statuses.mockResolvedValueOnce(saved).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const view = await mount();
    try {
      const button = checkButton(view.dialog());
      await act(async () => { button.click(); await settle(); });
      expect(statuses).toHaveBeenLastCalledWith(true);
      expect(button.disabled).toBe(true);
      expect(view.dialog().textContent).toContain('Checking…');
      expect(view.dialog().textContent).toContain('saved-version');
      expect(view.dialog().textContent).toContain('Last checked: 06/10/2026');
      await act(async () => { release(saved.map((status) => ({ ...status, version: 'new-version', checkedAt: '2026-10-07T10:00:00.000Z' }))); await settle(); });
      expect(view.dialog().textContent).toContain('new-version');
      expect(view.dialog().textContent).toContain('Last checked: 07/10/2026');
      await view.reopen();
      expect(statuses).toHaveBeenCalledTimes(2);
    } finally { await view.close(); }
  });

  it('loads fresh state when an executable path changes, including switching back', async () => {
    statuses.mockResolvedValue(saved);
    const view = await mount();
    try {
      await view.rerender({ ...view.preferences, aiExecutablePaths: { codex: 'C:\\tools\\codex.exe' } });
      await view.rerender({ ...view.preferences, aiExecutablePaths: {} });
      expect(statuses).toHaveBeenCalledTimes(3);
      expect(statuses.mock.calls.every(([force]) => force === false)).toBe(true);
    } finally { await view.close(); }
  });

  it('keeps the previous status when a refresh fails', async () => {
    statuses.mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('Disconnected'));
    const view = await mount();
    try {
      await act(async () => { checkButton(view.dialog()).click(); await settle(); });
      expect(view.dialog().textContent).toContain('saved-version');
      expect(view.dialog().textContent).toContain('Last checked: 06/10/2026');
      expect(toastError).toHaveBeenCalledWith(expect.objectContaining({ description: 'Disconnected' }));
    } finally { await view.close(); }
  });
});
