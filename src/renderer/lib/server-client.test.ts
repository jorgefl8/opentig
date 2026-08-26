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
  it('maps typed domain methods to their wire commands', async () => {
    const fixture = transportFixture();
    const { api } = createOpenTigServerClient({ transport: fixture.transport });

    await api.commits.list('repo-id', 'cursor');
    await api.index.stage('repo-id', ['one.txt']);

    expect(fixture.request).toHaveBeenNthCalledWith(1, IPC.commitsList, ['repo-id', 'cursor']);
    expect(fixture.request).toHaveBeenNthCalledWith(2, IPC.indexStage, ['repo-id', ['one.txt']]);
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
    fixture.event({ type: 'repository.active-changed', repository: bootstrapData().activeRepository! });
    await fixture.reconnect();

    expect(changed).toHaveBeenCalledWith('repo-id', 'refs');
    expect(activeChanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'repo-id' }));
    expect(changed).toHaveBeenCalledWith('repo-id', 'unknown');
    expect(fixture.request).toHaveBeenCalledWith(IPC.bootstrap, []);
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
