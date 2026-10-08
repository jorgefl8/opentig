// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { PublicationContext } from '@shared/repository-access';
import { useBranchPush } from './useBranchPush';
import { publicationKey } from './publication-context';
const refs = vi.hoisted(() => ({ pushContext: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { refs } }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const context = (id: string, login = 'alice'): PublicationContext => ({ id: `${id}-${login}`, repositoryId: id, branch: 'main', oid: 'a'.repeat(40), targetRef: 'refs/heads/main', remote: 'origin', urls: [`https://github.com/${login}/${id}.git`], remotes: ['origin'], mode: 'managed', login });
async function mount(cached: PublicationContext[] = []) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const value of cached) client.setQueryData(publicationKey(value.repositoryId), value);
  let hook!: ReturnType<typeof useBranchPush>;
  function Test() { hook = useBranchPush(); return null; }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Test))));
  return { get hook() { return hook; }, close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } };
}
it('uses the displayed account/destination without an extra confirmation for an ordinary push', async () => {
  const value = context('a'); refs.pushContext.mockResolvedValue(value); refs.push.mockResolvedValue({ status: 'success', commits: 1 });
  const view = await mount([value]);
  try {
    await act(async () => { expect(await view.hook.push('a', 'Project A')).toMatchObject({ status: 'success' }); });
    expect(view.hook.remoteChoice).toBeUndefined();
    expect(refs.push).toHaveBeenCalledWith('a', { remote: 'origin', expectedBranch: 'main', expectedOid: value.oid }, value.id);
  } finally { await view.close(); }
});
it('requires review when the effective account changes before publication', async () => {
  const changed = context('a', 'bob'); refs.pushContext.mockResolvedValue(changed); refs.push.mockResolvedValue({ status: 'success', commits: 1 });
  const view = await mount([context('a')]);
  try {
    let result!: ReturnType<typeof view.hook.push>;
    await act(async () => { result = view.hook.push('a', 'Project A'); await Promise.resolve(); });
    expect(refs.push).not.toHaveBeenCalled(); expect(view.hook.remoteChoice?.repositoryId).toBe('a');
    await act(async () => { view.hook.selectRemote(changed); await result; });
    expect(refs.push.mock.calls[0]?.[2]).toBe(changed.id);
  } finally { await view.close(); }
});
it('keeps concurrent project publications and errors attached to their own repositories', async () => {
  const a = context('a'); const b = context('b', 'bob');
  refs.pushContext.mockImplementation(id => Promise.resolve(id === 'a' ? a : b));
  refs.push.mockImplementation(id => Promise.resolve(id === 'a' ? { status: 'success', commits: 1 } : { status: 'rejected', reason: 'permission', message: 'B denied' }));
  const view = await mount();
  try {
    let first!: ReturnType<typeof view.hook.push>; let second!: ReturnType<typeof view.hook.push>;
    await act(async () => { first = view.hook.push('a', 'Project A'); second = view.hook.push('b', 'Project B'); await Promise.resolve(); });
    expect(view.hook.remoteChoice?.label).toBe('Project A');
    await act(async () => { view.hook.selectRemote(a); await first; });
    expect(view.hook.remoteChoice?.label).toBe('Project B');
    await act(async () => { view.hook.selectRemote(b); await second; });
    expect(await first).toMatchObject({ status: 'success' }); expect(await second).toMatchObject({ status: 'rejected', message: 'B denied' });
    expect(refs.push.mock.calls.map(call => [call[0], call[2]])).toEqual([['a', a.id], ['b', b.id]]);
  } finally { await view.close(); }
});

it('remembers a reviewed publication so the next ordinary push needs no repeated review', async () => {
  const value = context('a'); refs.pushContext.mockResolvedValue(value); refs.push.mockResolvedValue({ status: 'success', commits: 1 });
  const view = await mount();
  try {
    let first!: ReturnType<typeof view.hook.push>;
    await act(async () => { first = view.hook.push('a', 'Project A'); await Promise.resolve(); });
    expect(view.hook.remoteChoice).toBeDefined();
    await act(async () => { view.hook.selectRemote(value); await first; });
    await act(async () => { expect(await view.hook.push('a', 'Project A')).toMatchObject({ status: 'success' }); });
    expect(view.hook.remoteChoice).toBeUndefined();
    expect(refs.push).toHaveBeenCalledTimes(2);
  } finally { await view.close(); }
});

it('starts publication review with the effective push remote when it differs from the first remote', async () => {
  const value = { ...context('a'), remote: 'fork', remotes: ['origin', 'fork'] };
  refs.pushContext.mockResolvedValue(value);
  const view = await mount();
  try {
    let result!: ReturnType<typeof view.hook.push>;
    await act(async () => { result = view.hook.push('a', 'Project A'); await Promise.resolve(); });
    expect(view.hook.remoteChoice?.result.remotes).toEqual(['fork', 'origin']);
    await act(async () => { view.hook.selectRemote(null); await result; });
    expect(refs.push).not.toHaveBeenCalled();
  } finally { await view.close(); }
});
