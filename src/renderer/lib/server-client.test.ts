import { describe, expect, it, vi } from 'vitest';
import { IPC, type BootstrapData } from '@shared/contracts';
import { AI_CLIENT_TIMEOUT_MS } from '@shared/ai-timeouts';
import type { OpenTigRuntimeEvent } from '@shared/runtime-events';
import { OPEN_TIG_PROTOCOL_VERSION } from '@shared/server-protocol';
import { createOpenTigServerClient } from './server-client';
import type { OpenTigWebSocketTransport } from './websocket-transport';

function bootstrapData(protocolVersion = OPEN_TIG_PROTOCOL_VERSION): BootstrapData {
  return {
    recentRepositories: [],
    repositoryProjects: [],
    filesTreeStates: [],
    openFilesStates: [],
    activeRepository: {
      id: 'repo-id', name: 'main', repositoryName: 'repo', path: '/repo', commonDir: '/repo/.git',
    },
    preferences: {} as BootstrapData['preferences'],
    performanceAutomation: false,
    server: { protocolVersion, appVersion: '0.1.0' },
  };
}

function transportFixture() {
  let eventListener: ((event: OpenTigRuntimeEvent) => void) | null = null;
  let reconnectListener: (() => void | Promise<void>) | null = null;
  const request = vi.fn(async (command: string) => command === IPC.bootstrap ? bootstrapData() : []);
  const markIncompatible = vi.fn();
  const transport = {
    request,
    markIncompatible,
    onEvent: vi.fn((listener: typeof eventListener) => { eventListener = listener; return vi.fn(); }),
    onReconnect: vi.fn((listener: typeof reconnectListener) => { reconnectListener = listener; return vi.fn(); }),
  } as unknown as OpenTigWebSocketTransport;
  return {
    transport,
    request,
    markIncompatible,
    event: (event: OpenTigRuntimeEvent) => eventListener?.(event),
    reconnect: async () => { await reconnectListener?.(); },
  };
}

describe('OpenTig server client', () => {
  it('routes account commands and events separately from repository switches', async () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    const changed = vi.fn(); const switched = vi.fn();
    api.events.onGitHubAccountsChanged(changed);
    api.events.onActiveRepositoryChanged(switched);
    fixture.event({ type: 'github.accounts-changed' });
    expect(changed).toHaveBeenCalledOnce();
    expect(switched).not.toHaveBeenCalled();
    await api.github.accountsStatus(false);
    await api.github.repositoryAccount('repo-id', true);
    await api.github.setRepositoryAccount('repo-id', { mode: 'account', host: 'github.com', login: 'alice' });
    expect(fixture.request).toHaveBeenCalledWith(IPC.githubAccountsStatus, [false]);
    expect(fixture.request).toHaveBeenCalledWith(IPC.githubRepositoryAccount, ['repo-id', true]);
    expect(fixture.request).toHaveBeenCalledWith(IPC.githubSetRepositoryAccount, ['repo-id', { mode: 'account', host: 'github.com', login: 'alice' }]);
  });
  it('omits an absent directory path instead of serializing it as null', async () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    await api.repository.browseDirectories();
    await api.repository.browseDirectories('/home/projects');
    expect(fixture.request).toHaveBeenNthCalledWith(1, IPC.repositoryBrowseDirectories, []);
    expect(fixture.request).toHaveBeenNthCalledWith(2, IPC.repositoryBrowseDirectories, ['/home/projects']);
  });

  it('keeps AI generation requests open for long-running analysis', async () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    const commitInput = { repositoryId: 'repo-id', harness: 'codex' as const, model: 'default', requestId: 'commit-request' };
    const draftInput = { repositoryId: 'repo-id', base: 'main', harness: 'codex' as const, model: 'default', requestId: 'draft-request' };

    await api.ai.generateCommitMessage(commitInput);
    await api.github.generateDraft(draftInput);

    expect(fixture.request).toHaveBeenNthCalledWith(1, IPC.aiGenerateCommitMessage, [commitInput], { timeoutMs: AI_CLIENT_TIMEOUT_MS });
    expect(fixture.request).toHaveBeenNthCalledWith(2, IPC.githubPrDraft, [draftInput], { timeoutMs: AI_CLIENT_TIMEOUT_MS });
  });

  it('fails closed on an incompatible protocol version', async () => {
    const fixture = transportFixture();
    fixture.request.mockResolvedValueOnce(bootstrapData(OPEN_TIG_PROTOCOL_VERSION + 1));
    const { api } = createOpenTigServerClient({ transport: fixture.transport });

    await expect(api.app.bootstrap()).rejects.toThrow('incompatible');
    expect(fixture.markIncompatible).toHaveBeenCalledOnce();
  });

  it('publishes server events and refreshes the active repository after reconnect', async () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    const changed = vi.fn();
    const activeChanged = vi.fn();
    api.events.onRepositoryChanged(changed);
    api.events.onActiveRepositoryChanged(activeChanged);

    fixture.event({ type: 'repository.changed', repositoryId: 'repo-id', scope: 'refs' });
    // A watch in trouble reaches the listener as a change, which is what an older client takes it for too.
    fixture.event({ type: 'repository.changed', repositoryId: 'repo-id', scope: 'unknown', watch: 'degraded' });
    fixture.event({ type: 'repository.active-changed', repository: bootstrapData().activeRepository! });
    await fixture.reconnect();

    expect(changed).toHaveBeenCalledWith('repo-id', 'refs');
    expect(changed).toHaveBeenCalledWith('repo-id', 'unknown', 'degraded');
    expect(activeChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'repo-id' }));
    expect(changed).toHaveBeenCalledWith('repo-id', 'unknown');
    // The repository the server moved it to is the one it asks for again.
    expect(fixture.request).toHaveBeenCalledWith(IPC.bootstrap, [{ repositoryId: 'repo-id' }]);
  });

  it('asks for the repository it last opened when the connection comes back, not for whatever another client chose', async () => {
    const fixture = transportFixture();
    const other = { id: 'other-id', name: 'other', repositoryName: 'other', path: '/other', commonDir: '/other/.git' };
    fixture.request.mockImplementation(async (command: string) => command === IPC.bootstrap ? bootstrapData() : command === IPC.repositoryOpenRecent ? other as never : []);
    const { api } = createOpenTigServerClient({ transport: fixture.transport });

    await api.app.bootstrap();
    await api.repository.openRecent('other-id');
    await fixture.reconnect();

    expect(fixture.request).toHaveBeenLastCalledWith(IPC.bootstrap, [{ repositoryId: 'other-id' }]);
  });

  it('asks again for the repository of the open started last, whichever answer arrives last, as the server keeps it', async () => {
    const fixture = transportFixture();
    const repository = (id: string) => ({ id, name: id, repositoryName: id, path: `/${id}`, commonDir: `/${id}/.git` });
    const answers = new Map<string, { resolve(value: unknown): void; reject(reason: unknown): void }>();
    fixture.request.mockImplementation(async (command: string, args?: unknown[]) => {
      if (command === IPC.bootstrap) return bootstrapData();
      if (command !== IPC.repositoryOpenRecent) return [];
      return new Promise((resolve, reject) => answers.set(String(args![0]), { resolve, reject })) as never;
    });
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    await api.app.bootstrap();

    const earlier = api.repository.openRecent('b');
    const later = api.repository.openRecent('c');
    answers.get('c')!.resolve(repository('c'));
    await later;
    answers.get('b')!.resolve(repository('b'));
    await earlier;
    await fixture.reconnect();
    expect(fixture.request).toHaveBeenLastCalledWith(IPC.bootstrap, [{ repositoryId: 'c' }]);

    // One started later that fails leaves the one before it.
    const failing = api.repository.openRecent('d');
    answers.get('d')!.reject(new Error('Not a repository.'));
    await expect(failing).rejects.toThrow();
    await fixture.reconnect();
    expect(fixture.request).toHaveBeenLastCalledWith(IPC.bootstrap, [{ repositoryId: 'repo-id' }]);
  });

  it('follows where a server with a repository per client has it, by the highest numbered answer or move, and says when that changes', async () => {
    const fixture = transportFixture();
    const repository = (id: string) => ({ id, name: id, repositoryName: id, path: `/${id}`, commonDir: `/${id}/.git` });
    const answers = new Map<string, (value: unknown) => void>();
    const perClient = { ...bootstrapData(), attachment: { attached: true, repositoryId: 'repo-id', ticket: 1 } };
    perClient.server = { ...perClient.server!, repositoryPerClient: true };
    fixture.request.mockImplementation(async (command: string, args?: unknown[]) => {
      if (command === IPC.bootstrap) return perClient;
      if (command !== IPC.repositoryOpenRecent) return [];
      return new Promise((resolve) => answers.set(String(args![0]), resolve)) as never;
    });
    const { api, connection } = createOpenTigServerClient({ transport: fixture.transport });
    const changes = vi.fn();
    connection.subscribe(changes);
    await api.app.bootstrap();
    expect(connection.current()).toEqual({ repositoryId: 'repo-id', repository: expect.objectContaining({ id: 'repo-id' }) });

    // The server moved it to main; an open started before that answers late and did not take.
    const late = api.repository.openRecent('z');
    fixture.event({ type: 'repository.active-changed', repository: repository('main'), previousId: 'repo-id', reason: 'removed', ticket: 3 });
    answers.get('z')!({ ...repository('z'), attachment: { attached: false, repositoryId: 'main', ticket: 3 } });
    // The page gets the repository it asked for, without the server's note.
    expect(await late).toEqual(repository('z'));
    expect(connection.current()?.repositoryId).toBe('main');
    expect(changes).toHaveBeenCalledTimes(2);

    // A new connection numbers from the start again, and the page is told rather than moved.
    const moved = vi.fn();
    api.events.onActiveRepositoryChanged(moved);
    await fixture.reconnect();
    expect(fixture.request).toHaveBeenLastCalledWith(IPC.bootstrap, [{ repositoryId: 'main' }]);
    expect(connection.current()?.repositoryId).toBe('repo-id');
    expect(moved).not.toHaveBeenCalled();
  });

  it('passes on that news of a watch needs no read, and why and from where a client was moved', () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    const changed = vi.fn();
    const moved = vi.fn();
    api.events.onRepositoryChanged(changed);
    api.events.onActiveRepositoryChanged(moved);
    fixture.event({ type: 'repository.changed', repositoryId: 'repo-id', scope: 'unknown', watch: 'watching', watchId: 'w1', refresh: false });
    const main = { id: 'main', name: 'main', repositoryName: 'repo', path: '/repo', commonDir: '/repo/.git' };
    fixture.event({ type: 'repository.active-changed', repository: main, previousId: 'tree', reason: 'removed', recentRepositories: [], ticket: 2 });
    expect(changed).toHaveBeenCalledWith('repo-id', 'unknown', 'watching', 'w1', { refresh: false });
    expect(moved).toHaveBeenCalledWith(main, { previousId: 'tree', reason: 'removed', recentRepositories: [] });
  });

  it('passes on a relocation made elsewhere, with the new repository and the saved list, and nothing that would read the old id', () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    const changed = vi.fn();
    api.events.onRepositoryChanged(changed);
    const moved = { id: 'new-id', name: 'app', repositoryName: 'app', path: '/moved/app', commonDir: '/moved/app/.git' };
    fixture.event({ type: 'repository.changed', repositoryId: 'old-id', scope: 'unknown', relocatedTo: moved, recentRepositories: [] });
    expect(changed).toHaveBeenCalledExactlyOnceWith('old-id', 'unknown', undefined, undefined, { relocatedTo: moved, recentRepositories: [] });
  });

  it('tells a reconnect apart from an account change, so what GitHub said is refreshed rather than emptied', async () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });
    const accountsChanged = vi.fn();
    const reconnected = vi.fn();
    api.events.onGitHubAccountsChanged(accountsChanged);
    api.events.onReconnected(reconnected);

    await fixture.reconnect();
    expect(reconnected).toHaveBeenCalledOnce();
    expect(accountsChanged).not.toHaveBeenCalled();

    fixture.event({ type: 'github.accounts-changed' });
    expect(accountsChanged).toHaveBeenCalledOnce();
    expect(reconnected).toHaveBeenCalledOnce();
  });

  it('loads authenticated image bytes over HTTP', async () => {
    const fixture = transportFixture();
    const fetchRequest = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': '3',
        'X-OpenTig-Mtime-Ms': '42',
      },
    }));
    const { api } = createOpenTigServerClient({
      transport: fixture.transport,
      httpOrigin: 'http://127.0.0.1:6767',
      fetch: fetchRequest as typeof fetch,
    });

    await expect(api.repository.readImage('repo/id', 'images/a b.png')).resolves.toEqual({
      status: 'ready', path: 'images/a b.png', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]), size: 3, mtimeMs: 42,
    });
    expect(fetchRequest).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:6767/api/image/repo%2Fid/images/a%20b.png'),
      { credentials: 'include' },
    );
  });
});

it('transports global defaults and the reviewed setup revision without exposing credentials', async () => {
  const f = transportFixture(); const { api } = createOpenTigServerClient({ transport: f.transport });
  const changed = vi.fn(); api.events.onGitHubAccountsChanged(changed);
  await api.github.setDefaultAccount('alice');
  const selection = { mode: 'account' as const, host: 'github.com' as const, login: 'alice' };
  await api.github.setRepositoryAccount('repo', selection, 5);
  expect(f.request).toHaveBeenCalledWith(IPC.githubSetDefaultAccount, ['alice']);
  expect(f.request).toHaveBeenCalledWith(IPC.githubSetRepositoryAccount, ['repo', selection, 5]);
  f.event({ type: 'github.accounts-changed', repositoryIds: ['repo'], inventoryChanged: true });
  expect(changed).toHaveBeenLastCalledWith(['repo'], true, undefined);
  f.event({ type: 'github.accounts-changed', repositoryIds: ['repo'], detected: { login: 'bob', previousLogin: 'alice' } });
  expect(changed).toHaveBeenLastCalledWith(['repo'], undefined, { login: 'bob', previousLogin: 'alice' });
});

it('routes repository AI instructions and notifies only instruction listeners, without notifying account listeners', async () => {
  const f = transportFixture();
  const client = createOpenTigServerClient({ transport: f.transport });
  const changed = vi.fn(); const accountsChanged = vi.fn();
  const unsubscribe = client.api.events.onAiInstructionsChanged(changed);
  client.api.events.onGitHubAccountsChanged(accountsChanged);
  await client.api.ai.repositoryInstructions('repo');
  expect(f.request).toHaveBeenCalledWith(IPC.aiRepositoryInstructions, ['repo']);
  await client.api.ai.setRepositoryInstructions('repo', true);
  expect(f.request).toHaveBeenCalledWith(IPC.aiSetRepositoryInstructions, ['repo', true]);
  f.event({ type: 'ai.instructions-changed', repositoryIds: ['repo', 'worktree'] });
  expect(changed).toHaveBeenCalledWith(['repo', 'worktree']);
  expect(accountsChanged).not.toHaveBeenCalled();
  unsubscribe();
  f.event({ type: 'ai.instructions-changed', repositoryIds: ['repo'] });
  expect(changed).toHaveBeenCalledOnce();
});
