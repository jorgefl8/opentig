// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { RepositoryInfo } from '@shared/contracts';
import { RepositoryAiSettings } from './RepositoryAiSettings';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), toast: vi.fn(), changed: vi.fn(), repositoryChanged: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { ai: { repositoryInstructions: mocks.read, setRepositoryInstructions: mocks.write }, events: { onAiInstructionsChanged: mocks.changed, onRepositoryChanged: mocks.repositoryChanged } } }));
vi.mock('sileo', () => ({ sileo: { error: mocks.toast } }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
const repository: RepositoryInfo = { id: 'repo', name: 'sample', repositoryName: 'sample', path: '/sample', commonDir: '/sample/.git' };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
async function mount(repo: RepositoryInfo | null = repository) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(RepositoryAiSettings, { repository: repo }))); await settle(); });
  await act(settle);
  return { container, toggle: () => container.querySelector('[role="switch"]') as HTMLButtonElement,
    close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } };
}
it('displays detected files, waits for a successful save and keeps the old value when a save fails', async () => {
  mocks.changed.mockReturnValue(() => {}); mocks.repositoryChanged.mockReturnValue(() => {});
  mocks.read.mockResolvedValue({ enabled: false, files: ['AGENTS.md'] });
  mocks.write.mockResolvedValueOnce({ enabled: true, files: ['AGENTS.md'] }).mockRejectedValueOnce(new Error('Unavailable'));
  const view = await mount();
  try {
    expect(view.container.textContent).toContain('Detected: AGENTS.md');
    expect(view.toggle().getAttribute('aria-checked')).toBe('false');
    await act(async () => { view.toggle().click(); await settle(); });
    expect(mocks.write).toHaveBeenCalledWith('repo', true);
    expect(view.toggle().getAttribute('aria-checked')).toBe('true');
    await act(async () => { view.toggle().click(); await settle(); });
    expect(view.toggle().getAttribute('aria-checked')).toBe('true');
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Could not save repository instructions' });
  } finally { await view.close(); }
});
it('refreshes the visible option when another client changes this repository', async () => {
  let changed!: (ids: string[]) => void;
  mocks.changed.mockImplementation(fn => { changed = fn; return () => {}; }); mocks.repositoryChanged.mockReturnValue(() => {});
  mocks.read.mockResolvedValue({ enabled: false, files: [] });
  const view = await mount();
  try {
    mocks.read.mockResolvedValue({ enabled: true, files: [] });
    await act(async () => { changed(['other']); await settle(); });
    expect(view.toggle().getAttribute('aria-checked')).toBe('false');
    await act(async () => { changed(['repo']); await settle(); });
    expect(view.toggle().getAttribute('aria-checked')).toBe('true');
  } finally { await view.close(); }
});
it('disables the option and makes no instruction request without an open repository', async () => {
  mocks.changed.mockReturnValue(() => {}); mocks.repositoryChanged.mockReturnValue(() => {});
  const view = await mount(null);
  try { expect(view.toggle().disabled).toBe(true); expect(mocks.read).not.toHaveBeenCalled(); }
  finally { await view.close(); }
});
