// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublicationContext } from '@shared/repository-access';
import { useBranchPush } from './useBranchPush';
import { publicationKey } from './publication-context';
const refs = vi.hoisted(() => ({ pushContext: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/opentig-api', () => ({ opentig: { refs } }));
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const context = (id: string, login = 'alice'): PublicationContext => ({ id: `${id}-${login}`, repositoryId: id, branch: 'main', oid: 'a'.repeat(40), targetRef: 'refs/heads/main', remote: 'origin', urls: [`https://github.com/${login}/${id}.git`], remotes: ['origin'], mode: 'managed', login, hasUpstream: true });
async function mount(cached: PublicationContext[] = []) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const value of cached) client.setQueryData(publicationKey(value.repositoryId), value);
  let hook!: ReturnType<typeof useBranchPush>;
  function Test() {
    const value = useBranchPush();
    useLayoutEffect(() => { hook = value; }, [value]);
    return null;
  }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Test))));
  return { get hook() { return hook; }, close: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } };
}
it('pushes from a fresh client without Settings, cached review or browser storage', async () => {
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('No storage'); });
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('No storage'); });
  const value = context('a'); refs.pushContext.mockResolvedValue(value); refs.push.mockResolvedValue({ status: 'success', commits: 1 });
  const view = await mount();
  try {
    await act(async () => { expect(await view.hook.push('a', 'A')).toMatchObject({ status: 'success' }); });
    expect(view.hook.remoteChoice).toBeUndefined();
    expect(refs.push).toHaveBeenCalledWith('a', { remote: 'origin', expectedBranch: 'main', expectedOid: value.oid }, value.id);
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
  } finally { await view.close(); get.mockRestore(); set.mockRestore(); }
});

it('uses the same server configuration from two independent clients and after switching branches', async () => {
  const a = await mount(); const b = await mount();
  refs.push.mockResolvedValue({ status: 'success', commits: 1 });
  try {
    for (const branch of ['main', 'feature', 'main']) {
      const value = { ...context('a'), branch, targetRef: `refs/heads/${branch}` };
      refs.pushContext.mockResolvedValue(value);
      for (const view of [a, b]) {
        await act(async () => { await view.hook.push('a', 'A'); });
        expect(view.hook.remoteChoice).toBeUndefined();
        expect(refs.push).toHaveBeenLastCalledWith('a', { remote: 'origin', expectedBranch: branch, expectedOid: value.oid }, value.id);
      }
    }
    expect(refs.push).toHaveBeenCalledTimes(6);
  } finally { await a.close(); await b.close(); }
});

it('does not treat Settings cache as an approval or a configuration source', async () => {
  const value = context('a', 'bob'); refs.pushContext.mockResolvedValue(value); refs.push.mockResolvedValue({ status: 'success', commits: 1 });
  const view = await mount([context('a', 'alice')]);
  try {
    await act(async () => { await view.hook.push('a', 'A'); });
    expect(view.hook.remoteChoice).toBeUndefined();
    expect(refs.push.mock.calls[0]?.[2]).toBe(value.id);
  } finally { await view.close(); }
});

it('uses a fresh server context after new commits without another review', async () => {
  const value = context('a'); const fresh = { ...value, id: 'fresh', oid: 'b'.repeat(40) };
  refs.pushContext.mockResolvedValue(fresh); refs.push.mockResolvedValue({ status: 'success', commits: 1 });
  const view = await mount();
  try {
    await act(async () => { await view.hook.push('a', 'A'); });
    expect(refs.push).toHaveBeenCalledWith('a', { remote: 'origin', expectedBranch: 'main', expectedOid: fresh.oid }, 'fresh');
  } finally { await view.close(); }
});

it('publishes a new branch directly when the server already resolves its destination', async () => {
  const value = { ...context('a'), hasUpstream: false };
  refs.pushContext.mockResolvedValue(value); refs.push.mockResolvedValue({ status: 'published', branch: 'main', remote: 'origin' });
  const view = await mount();
  try {
    await act(async () => { expect(await view.hook.push('a', 'A')).toMatchObject({ status: 'published' }); });
    expect(view.hook.remoteChoice).toBeUndefined();
  } finally { await view.close(); }
});

it('only asks for a destination when it is genuinely missing and keeps concurrent repositories isolated', async () => {
  const a = context('a'); const b = context('b', 'bob');
  refs.pushContext.mockImplementation(id => Promise.resolve({ ...(id === 'a' ? a : b), remote: null, urls: [], remotes: ['origin', 'fork'] }));
  refs.push.mockImplementation(id => Promise.resolve(id === 'a' ? { status: 'success', commits: 1 } : { status: 'rejected', reason: 'permission', message: 'B denied' }));
  const view = await mount();
  try {
    let first!: ReturnType<typeof view.hook.push>; let second!: ReturnType<typeof view.hook.push>;
    await act(async () => { first = view.hook.push('a', 'A'); second = view.hook.push('b', 'B'); await Promise.resolve(); });
    expect(refs.push).not.toHaveBeenCalled(); expect(view.hook.remoteChoice?.label).toBe('A');
    await act(async () => { view.hook.selectRemote(a); await first; });
    expect(view.hook.remoteChoice?.label).toBe('B');
    await act(async () => { view.hook.selectRemote(b); await second; });
    expect(await second).toMatchObject({ status: 'rejected', message: 'B denied' });
    expect(refs.push.mock.calls.map(call => [call[0], call[2]])).toEqual([['a', a.id], ['b', b.id]]);
  } finally { await view.close(); }
});

it('cancels a missing destination without pushing or saving an approval', async () => {
  refs.pushContext.mockResolvedValue({ ...context('a'), remote: null });
  const view = await mount();
  try {
    let result!: ReturnType<typeof view.hook.push>;
    await act(async () => { result = view.hook.push('a', 'A'); await Promise.resolve(); });
    await act(async () => { view.hook.selectRemote(null); expect(await result).toBeNull(); });
    expect(refs.push).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
  } finally { await view.close(); }
});
