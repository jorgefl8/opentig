import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { OneTimeBootstrapAuthSource } from './auth';
import { runOpenTigServer, type RunningOpenTigServer } from './server';

// Each connection, one browser tab or desktop window, has its own open repository, against a real
// server, real Git and real folders: what one opens, and what changes in it, reaches no other.

const execFileAsync = promisify(execFile);
const servers: RunningOpenTigServer[] = [];
const directories: string[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
});

interface Repository { id: string; name: string; path: string; commonDir: string }
interface WatchEvent { type: 'repository.changed'; repositoryId: string; scope: string; watch?: string; watchId?: string }

/** One connection, as a client sees it: what it asked and what it was sent. */
class Client {
  readonly events: WatchEvent[] = [];
  readonly otherEvents: { type: string; repository?: Repository }[] = [];
  /** Everything received, in order: `answer:<command>`, `<repository id>:<watch state or change>`. */
  readonly log: string[] = [];
  private readonly commands = new Map<string, string>();
  private sequence = 0;
  private readonly waiting = new Map<string, (result: { ok: boolean; value?: unknown; error?: { code: string; message: string } }) => void>();

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; id?: string; result?: never; event?: { type: string } };
      if (message.type === 'result' && message.id) {
        this.log.push(`answer:${this.commands.get(message.id)}`);
        this.waiting.get(message.id)?.(message.result!);
      } else if (message.type === 'event' && message.event?.type === 'repository.changed') {
        const event = message.event as WatchEvent;
        this.log.push(`${event.repositoryId}:${event.watch ?? 'change'}`);
        this.events.push(event);
      } else if (message.type === 'event' && message.event) {
        this.log.push(message.event.type);
        this.otherEvents.push(message.event);
      }
    });
  }

  request<Value = unknown>(command: string, ...args: unknown[]): Promise<{ ok: boolean; value?: Value; error?: { code: string; message: string } }> {
    const id = String(++this.sequence);
    this.commands.set(id, command);
    return new Promise((resolve) => {
      this.waiting.set(id, (result) => { this.waiting.delete(id); resolve(result as never); });
      this.socket.send(JSON.stringify({ type: 'request', id, command, args }));
    });
  }

  async value<Value>(command: string, ...args: unknown[]): Promise<Value> {
    const result = await this.request<Value>(command, ...args);
    if (!result.ok) throw new Error(`${command} failed: ${result.error?.message}`);
    return result.value!;
  }

  /** Answered only after everything the server sent this connection before it. */
  async settled(): Promise<void> {
    await this.value('app:git-status');
  }

  /** The latest watch this connection was told of for the repository, once it is watching. */
  async watching(repositoryId: string): Promise<string> {
    let watchId = '';
    await vi.waitFor(() => {
      const last = this.events.filter((event) => event.repositoryId === repositoryId && event.watch).at(-1);
      expect(last?.watch).toBe('watching');
      watchId = last!.watchId!;
    }, { timeout: 10_000, interval: 25 });
    return watchId;
  }
}

async function startServer() {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-per-client-'));
  directories.push(directory);
  const clientRoot = path.join(directory, 'client');
  await mkdir(clientRoot, { recursive: true });
  await writeFile(path.join(clientRoot, 'index.html'), '<!doctype html><html lang="en"><title>OpenTig test client</title></html>');
  const desktopSecret = `desktop-${crypto.randomUUID()}`;
  const server = await runOpenTigServer({
    settingsPath: path.join(directory, 'settings.json'),
    aiLogPath: path.join(directory, 'ai-log.jsonl'),
    platform: 'linux',
    trash: { available: true, trashItem: async () => undefined },
    clientRoot,
    appVersion: '0.1-test',
    browserAccessEnabled: true,
    auth: new OneTimeBootstrapAuthSource({ desktopSecret }),
    port: 0,
  });
  servers.push(server);
  const response = await fetch(`${server.origin}/api/auth/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ secret: desktopSecret }),
  });
  const cookie = (response.headers.get('set-cookie') ?? '').split(';', 1)[0]!;
  const connect = async (): Promise<Client> => {
    const socket = new WebSocket(`${server.origin.replace(/^http/, 'ws')}/ws`, { headers: { Origin: server.origin, Cookie: cookie } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); });
    return new Client(socket);
  };
  const repository = async (name: string): Promise<string> => {
    const work = path.join(directory, name);
    await execFileAsync('git', ['init', '-q', '-b', 'main', work]);
    await writeFile(path.join(work, 'README.md'), `# ${name}\n`);
    return work;
  };
  return { server, services: server.runtime.services, connect, repository, directory };
}

const closed = (socket: WebSocket) => new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));

describe('a repository per client', () => {
  it('sends each connection the changes of its own repository only', async () => {
    const { connect, repository } = await startServer();
    const [pathA, pathB] = await Promise.all([repository('alpha'), repository('beta')]);
    const first = await connect();
    const second = await connect();
    const alpha = await first.value<Repository>('repository:open-path', pathA);
    const beta = await second.value<Repository>('repository:open-path', pathB);
    await first.watching(alpha.id);
    await second.watching(beta.id);

    await writeFile(path.join(pathA, 'alpha.txt'), 'changed\n');
    await vi.waitFor(() => expect(first.events.some((event) => event.repositoryId === alpha.id && !event.watch)).toBe(true), { timeout: 10_000 });
    await writeFile(path.join(pathB, 'beta.txt'), 'changed\n');
    await vi.waitFor(() => expect(second.events.some((event) => event.repositoryId === beta.id && !event.watch)).toBe(true), { timeout: 10_000 });
    await Promise.all([first.settled(), second.settled()]);

    expect(first.events.map((event) => event.repositoryId)).not.toContain(beta.id);
    expect(second.events.map((event) => event.repositoryId)).not.toContain(alpha.id);
    // Nobody is told another opened a repository.
    expect([...first.otherEvents, ...second.otherEvents].map((event) => event.type)).not.toContain('repository.active-changed');
  });

  it('shares one watch between connections on the same repository, each knowing it by an id of its own', async () => {
    const { connect, repository, services } = await startServer();
    const work = await repository('shared');
    const first = await connect();
    const second = await connect();
    const opened = await first.value<Repository>('repository:open-path', work);
    await second.value('repository:open-recent', opened.id);
    const firstWatch = await first.watching(opened.id);
    const secondWatch = await second.watching(opened.id);
    expect(services.watcher.watchedCount).toBe(1);
    expect(firstWatch).not.toBe(secondWatch);

    // A read is covered under the id this connection was told, and no other.
    const read = await first.value<{ watchId?: string }>('repository:read-file', opened.id, 'README.md');
    expect(read.watchId).toBe(firstWatch);

    await writeFile(path.join(work, 'together.txt'), 'changed\n');
    await vi.waitFor(() => {
      expect(first.events.some((event) => !event.watch && event.repositoryId === opened.id)).toBe(true);
      expect(second.events.some((event) => !event.watch && event.repositoryId === opened.id)).toBe(true);
    }, { timeout: 10_000 });
  });

  it('switching in one connection moves no other, and coming back gives a watch id never used before', async () => {
    const { connect, repository, services } = await startServer();
    const [pathA, pathB] = await Promise.all([repository('alpha'), repository('beta')]);
    const first = await connect();
    const second = await connect();
    const alpha = await first.value<Repository>('repository:open-path', pathA);
    const beta = await first.value<Repository>('repository:open-path', pathB);
    await second.value('repository:open-recent', alpha.id);
    const before = await first.watching(beta.id);

    await first.value('repository:open-recent', alpha.id);
    const onAlpha = await first.watching(alpha.id);
    await first.value('repository:open-recent', beta.id);
    // The watch of beta was kept for the grace period, but this connection heard nothing of beta meanwhile.
    const back = await first.watching(beta.id);
    await first.value('repository:open-recent', alpha.id);
    const onAlphaAgain = await first.watching(alpha.id);
    expect(new Set([before, onAlpha, back, onAlphaAgain]).size).toBe(4);
    expect(services.watcher.watchedCount).toBe(2);
    expect(services.clients.connectionsOn(alpha.id).size).toBe(2);
    expect(services.clients.connectionsOn(beta.id).size).toBe(0);
    await second.settled();
    expect(second.events.map((event) => event.repositoryId)).not.toContain(beta.id);
  });

  it('tells a connection the repository it left is no longer watched for it, after the answer to the open, and the one it joined after that', async () => {
    const { connect, repository } = await startServer();
    const [pathA, pathB] = await Promise.all([repository('alpha'), repository('beta')]);
    const first = await connect();
    const second = await connect();
    const beta = await second.value<Repository>('repository:open-path', pathB);
    await second.watching(beta.id);
    const alpha = await first.value<Repository>('repository:open-path', pathA);
    await first.watching(alpha.id);

    first.log.length = 0;
    await first.value('repository:open-recent', beta.id);
    await first.watching(beta.id);
    // Nothing about either repository comes before the answer, which a client would take for the one it is leaving.
    expect(first.log).toEqual(['answer:repository:open-recent', `${alpha.id}:stopped`, `${beta.id}:watching`]);
  });

  it('detaches every connection from a repository removed from OpenTig, and never announces it a watch it is not counted on', async () => {
    const { connect, repository, services } = await startServer();
    const work = await repository('alpha');
    const first = await connect();
    const second = await connect();
    const alpha = await first.value<Repository>('repository:open-path', work);
    await first.watching(alpha.id);

    await second.value('repository:forget', alpha.commonDir);
    await vi.waitFor(() => expect(first.events.at(-1)).toMatchObject({ repositoryId: alpha.id, watch: 'stopped' }));
    expect(services.clients.repositoryOf([...services.clients.connectionsOn(alpha.id)][0] ?? '')).toBeNull();
    expect(services.clients.connectionsOn(alpha.id).size).toBe(0);

    // Added again by another connection, which then leaves: the first one hears nothing of that watch.
    first.log.length = 0;
    const again = await second.value<Repository>('repository:open-path', work);
    expect(again.id).toBe(alpha.id);
    await second.watching(alpha.id);
    const other = await repository('beta');
    await second.value('repository:open-path', other);
    await Promise.all([first.settled(), second.settled()]);
    expect(first.log.filter((entry) => entry.startsWith(alpha.id))).toEqual([]);
    expect(await first.value<{ watchId?: string }>('repository:read-file', alpha.id, 'README.md')).not.toHaveProperty('watchId');
  });

  it('keeps each tab’s cut its own: another tab of the same browser opening a repository does not turn it into a copy', async () => {
    const { connect, repository } = await startServer();
    const [pathA, pathB] = await Promise.all([repository('alpha'), repository('beta')]);
    await mkdir(path.join(pathA, 'moved'));
    await writeFile(path.join(pathA, 'notes.txt'), 'cut me\n');
    // Both tabs share the session of one browser.
    const first = await connect();
    const second = await connect();
    const alpha = await first.value<Repository>('repository:open-path', pathA);
    const cut = await first.value<{ paths: string[]; transferId: string }>('repository:cut-entries', alpha.id, ['notes.txt']);

    await second.value('repository:open-path', pathB);
    const pasted = await first.value<{ source: string }>('repository:paste-entries', alpha.id, 'moved', cut.paths, cut.transferId, null);

    expect(pasted.source).toBe('cut');
    await expect(readFile(path.join(pathA, 'moved', 'notes.txt'), 'utf8')).resolves.toBe('cut me\n');
    await expect(readFile(path.join(pathA, 'notes.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never moves a cut into a repository other than the one it was made in', async () => {
    const { connect, repository } = await startServer();
    const [pathA, pathB] = await Promise.all([repository('alpha'), repository('beta')]);
    await writeFile(path.join(pathA, 'notes.txt'), 'stay\n');
    const client = await connect();
    const beta = await client.value<Repository>('repository:open-path', pathB);
    const alpha = await client.value<Repository>('repository:open-path', pathA);
    const cut = await client.value<{ paths: string[]; transferId: string }>('repository:cut-entries', alpha.id, ['notes.txt']);

    const pasted = await client.value<{ source: string }>('repository:paste-entries', beta.id, '', cut.paths, cut.transferId, null);

    expect(pasted.source).toBe('files');
    await expect(readFile(path.join(pathA, 'notes.txt'), 'utf8')).resolves.toBe('stay\n');
  });

  it('opens the repository a client asks for at start for it alone, and the last one opened for a client that asks for none', async () => {
    const { connect, repository, services } = await startServer();
    const [pathA, pathB] = await Promise.all([repository('alpha'), repository('beta')]);
    const setup = await connect();
    const alpha = await setup.value<Repository>('repository:open-path', pathA);
    const beta = await setup.value<Repository>('repository:open-path', pathB);
    expect(services.settings.activeRepositoryId).toBe(beta.id);

    const reloaded = await connect();
    const own = await reloaded.value<{ activeRepository: Repository; server: { repositoryPerClient?: boolean } }>('app:bootstrap', { repositoryId: alpha.id });
    expect(own.activeRepository.id).toBe(alpha.id);
    expect(own.server.repositoryPerClient).toBe(true);
    // A reload changes nothing saved: the repository opened last is still the one for a new client.
    expect(services.settings.activeRepositoryId).toBe(beta.id);

    // An older client sends nothing, and gets the repository opened last, as before.
    const older = await connect();
    const shared = await older.value<{ activeRepository: Repository }>('app:bootstrap');
    expect(shared.activeRepository.id).toBe(beta.id);
    await older.value('repository:open-recent', alpha.id);
    await older.watching(alpha.id);
    await setup.settled();
    expect(setup.events.filter((event) => event.repositoryId === alpha.id)).toEqual([]);

    const unknown = await connect();
    const fallback = await unknown.value<{ activeRepository: Repository }>('app:bootstrap', { repositoryId: '0123456789abcdef' });
    expect(fallback.activeRepository.id).toBe(alpha.id);
    for (const malformed of [{ repositoryId: '../alpha' }, { repositoryId: 7 }, { repositoryId: alpha.id, path: pathA }, 'alpha']) {
      expect(await unknown.request('app:bootstrap', malformed)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
  });

  it('lands a reconnecting client on its own repository, with the watch it left still running', async () => {
    const { connect, repository, services } = await startServer();
    const [pathA, pathB] = await Promise.all([repository('alpha'), repository('beta')]);
    const first = await connect();
    const second = await connect();
    const alpha = await first.value<Repository>('repository:open-path', pathA);
    await first.watching(alpha.id);
    const beta = await second.value<Repository>('repository:open-path', pathB);
    await second.watching(beta.id);

    const gone = closed(first.socket);
    first.socket.close();
    await gone;
    await vi.waitFor(() => expect(services.clients.connectionsOn(alpha.id).size).toBe(0));
    expect(services.watcher.watchedCount).toBe(2);

    const back = await connect();
    const data = await back.value<{ activeRepository: Repository; activeRepositoryWatch?: { state: string; watchId?: string } }>('app:bootstrap', { repositoryId: alpha.id });
    expect(data.activeRepository.id).toBe(alpha.id);
    expect(data.activeRepositoryWatch).toEqual({ state: 'watching', watchId: expect.any(String) });
    expect(services.watcher.watchedCount).toBe(2);
    const read = await back.value<{ watchId?: string }>('repository:read-file', alpha.id, 'README.md');
    expect(read.watchId).toBe(data.activeRepositoryWatch!.watchId);
  });

  it('forgets a connection that dies without a close frame, and keeps nothing for a client without a session', async () => {
    const { connect, repository, services, server } = await startServer();
    const work = await repository('alpha');
    const client = await connect();
    const opened = await client.value<Repository>('repository:open-path', work);
    expect(services.clients.size).toBe(1);
    client.socket.terminate();
    await vi.waitFor(() => expect(services.clients.size).toBe(0));
    expect(services.clients.connectionsOn(opened.id).size).toBe(0);

    const stranger = new WebSocket(`${server.origin.replace(/^http/, 'ws')}/ws`, { headers: { Origin: server.origin } });
    sockets.push(stranger);
    expect(await closed(stranger)).toBe(1008);
    expect(services.clients.size).toBe(0);
  });

  it('refuses to remove a worktree another connection has open', async () => {
    const { connect, repository } = await startServer();
    const work = await repository('main');
    await execFileAsync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'Start'], { cwd: work });
    const linked = path.join(path.dirname(work), 'linked');
    await execFileAsync('git', ['worktree', 'add', '-q', '-b', 'feature', linked], { cwd: work });
    const first = await connect();
    const second = await connect();
    const main = await first.value<Repository>('repository:open-path', work);
    const other = await second.value<Repository>('repository:open-path', linked);
    const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: linked })).stdout.trim();

    const refused = await first.request('refs:remove-worktree', { repositoryId: main.id, path: other.path, expectedOid: head, force: false, deleteBranch: false });
    expect(refused).toMatchObject({ ok: false, error: { message: expect.stringContaining('open in another window') } });
    await expect(execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: linked })).resolves.toBeDefined();
  });
});
