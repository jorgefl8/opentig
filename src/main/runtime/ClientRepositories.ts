import { randomUUID } from 'node:crypto';
import type { RepositoryInfo } from '../../shared/contracts';
import type { RepositoryChangeScope } from '../../shared/repository-change';
import type { OpenTigRuntimeEvent, RepositoryWatchState } from '../../shared/runtime-events';
import type { RepositoryWatchPool } from '../files/RepositoryWatchPool';

/** Connections with a repository at once. Above the transport's own limit, which keeps it far lower. */
export const MAX_CLIENT_CONNECTIONS = 256;

/** Sends an event to these connections only. */
export type ClientEventSink = (event: OpenTigRuntimeEvent, connectionIds: ReadonlySet<string>) => void;

interface ClientConnection {
  repository: RepositoryInfo | null;
  /** The watch of the pool this connection was last told about, and the state it was told. */
  watchId: string | null;
  told: RepositoryWatchState | null;
  /**
   * The id this connection knows that watch by. A new one each time the connection joins a watch,
   * so a read it made before leaving the repository never counts as covered after it comes back:
   * it heard nothing of the repository meanwhile.
   */
  clientWatchId: string | null;
  /** The latest open the connection started, and the one whose repository it has. */
  started: number;
  attached: number;
}

/**
 * The repository each connection has open. A connection is one browser tab or desktop window,
 * created by the transport once its session is proven, so one client never sets or reads
 * another's. Each repository a connection has open is held in the watch pool, and changes and
 * watch announcements of a repository go only to the connections that have it open.
 */
export class ClientRepositories {
  private readonly connections = new Map<string, ClientConnection>();

  constructor(
    private readonly pool: RepositoryWatchPool,
    private readonly send: ClientEventSink,
  ) {}

  get size(): number { return this.connections.size; }

  /** A signed-in connection arrived. False when there is no room for another. */
  connect(connectionId: string): boolean {
    if (this.connections.has(connectionId)) return true;
    if (this.connections.size >= MAX_CLIENT_CONNECTIONS) return false;
    this.connections.set(connectionId, { repository: null, watchId: null, told: null, clientWatchId: null, started: 0, attached: 0 });
    return true;
  }

  /** The connection closed or died: its repository is released, after the pool's grace period. */
  disconnect(connectionId: string): void {
    if (!this.connections.delete(connectionId)) return;
    this.pool.release(connectionId);
  }

  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  repositoryOf(connectionId: string): string | null {
    return this.connections.get(connectionId)?.repository?.id ?? null;
  }

  /**
   * Called as an open starts, before anything is awaited: of several opens on one connection, the
   * one started last decides its repository, whichever finishes first. Zero for no connection.
   */
  beginOpen(connectionId: string | undefined): number {
    const connection = connectionId === undefined ? undefined : this.connections.get(connectionId);
    if (!connection) return 0;
    connection.started += 1;
    return connection.started;
  }

  /**
   * The connection now has `repository` open. Once the answer to the open is on its way (`afterAnswer`),
   * the connection is told the repository it left is no longer watched for it, and, unless `quiet`, how
   * the one it opened is: a client takes a watch only for the repository it has arrived on.
   * False when the connection is gone, or a later open on it already finished.
   */
  attach(connectionId: string | undefined, repository: RepositoryInfo, ticket: number, options: { quiet?: boolean; afterAnswer?: (task: () => void) => void } = {}): boolean {
    const connection = connectionId === undefined ? undefined : this.connections.get(connectionId);
    if (!connectionId || !connection || ticket < connection.attached) return false;
    connection.attached = ticket;
    const left = connection.repository && connection.repository.id !== repository.id && connection.told && connection.told !== 'stopped'
      ? connection.repository.id : null;
    if (connection.repository?.id !== repository.id) {
      connection.watchId = null;
      connection.clientWatchId = null;
      connection.told = null;
    }
    connection.repository = repository;
    this.pool.hold(connectionId, repository);
    if (options.quiet) {
      const watch = this.watchOf(connectionId, connection);
      if (watch) connection.told = watch.state;
    }
    const tell = () => {
      if (this.connections.get(connectionId) !== connection) return;
      if (left && connection.repository?.id !== left) this.sendWatch(connectionId, left, 'stopped', null);
      if (!options.quiet && connection.repository?.id === repository.id) this.announce(connectionId, connection);
    };
    if (options.afterAnswer) options.afterAnswer(tell);
    else tell();
    return true;
  }

  /** Tells the connection how its repository is watched, unless it was already told so. */
  private announce(connectionId: string, connection: ClientConnection): void {
    const watch = this.watchOf(connectionId, connection);
    if (!watch || watch.state === connection.told) return;
    connection.told = watch.state;
    this.sendWatch(connectionId, connection.repository!.id, watch.state, watch.watchId);
  }

  /** How the connection's repository is watched, as the connection is to know it; undefined while it is being set up. */
  watch(connectionId: string | undefined, repositoryId: string): { state: RepositoryWatchState; watchId?: string } | undefined {
    const connection = connectionId === undefined ? undefined : this.connections.get(connectionId);
    if (!connectionId || !connection || connection.repository?.id !== repositoryId) return undefined;
    const watch = this.watchOf(connectionId, connection);
    if (!watch) return undefined;
    connection.told = watch.state;
    return { state: watch.state, ...(watch.watchId ? { watchId: watch.watchId } : {}) };
  }

  /**
   * The id the connection knows the watch reporting changes to this file by, or null when it cannot
   * rely on hearing of a change to it: it does not have the repository open, has not been told of
   * the watch, or the watch does not cover the file.
   */
  covers(connectionId: string | undefined, repositoryId: string, relativePath: string): string | null {
    const connection = connectionId === undefined ? undefined : this.connections.get(connectionId);
    if (!connection || connection.repository?.id !== repositoryId || !connection.clientWatchId || !connection.watchId) return null;
    return this.pool.covers(repositoryId, relativePath) === connection.watchId ? connection.clientWatchId : null;
  }

  /** Connections that have the repository open. */
  connectionsOn(repositoryId: string): Set<string> {
    const ids = new Set<string>();
    for (const [id, connection] of this.connections) if (connection.repository?.id === repositoryId) ids.add(id);
    return ids;
  }

  /**
   * Takes every connection on one of `fromIds`, but `except`, to `repository`: its worktree was
   * removed, or it moved and has a new id. Each is told as older servers told every client of a new
   * active repository, which clients of any version follow, and then how `repository` is watched.
   */
  move(fromIds: Iterable<string>, repository: RepositoryInfo, except?: string): void {
    const from = new Set(fromIds);
    for (const [id, connection] of this.connections) {
      if (id === except || !connection.repository || !from.has(connection.repository.id)) continue;
      const ticket = this.beginOpen(id);
      this.send({ type: 'repository.active-changed', repository }, new Set([id]));
      // What it was told of the repository it leaves is not repeated: that repository is gone.
      connection.told = null;
      this.attach(id, repository, ticket);
    }
  }

  /** A change to the repository, for the connections that have it open. */
  changed(repositoryId: string, scope: RepositoryChangeScope): void {
    const recipients = this.connectionsOn(repositoryId);
    if (recipients.size > 0) this.send({ type: 'repository.changed', repositoryId, scope }, recipients);
  }

  /** The pool's watch of the repository went from one state to another. */
  watchChanged(repositoryId: string, state: RepositoryWatchState, watchId: string | null): void {
    for (const [id, connection] of this.connections) {
      // Only a connection the pool counts on the repository is told it is watched.
      if (connection.repository?.id !== repositoryId || this.pool.heldBy(id) !== repositoryId) continue;
      if (state === 'watching' && watchId) {
        connection.watchId = watchId;
        connection.clientWatchId = randomUUID();
      } else {
        connection.watchId = null;
        connection.clientWatchId = null;
      }
      connection.told = state;
      this.sendWatch(id, repositoryId, state, connection.clientWatchId);
    }
  }

  /**
   * Repositories removed from OpenTig: whoever has one open no longer has a repository here, and is
   * told its watch is over; then the watch stops.
   */
  forget(repositoryIds: Iterable<string>): void {
    for (const repositoryId of repositoryIds) {
      for (const [id, connection] of this.connections) {
        if (connection.repository?.id !== repositoryId) continue;
        connection.repository = null;
        connection.watchId = null;
        connection.clientWatchId = null;
        connection.told = null;
        this.pool.release(id);
        this.sendWatch(id, repositoryId, 'stopped', null);
      }
      this.pool.forget(repositoryId);
    }
  }

  private watchOf(connectionId: string, connection: ClientConnection): { state: RepositoryWatchState; watchId: string | null } | undefined {
    const repositoryId = connection.repository!.id;
    if (this.pool.heldBy(connectionId) !== repositoryId) return { state: 'stopped', watchId: null };
    const status = this.pool.status(repositoryId);
    if (status.state === 'starting') return undefined;
    if (status.state === 'watching' && status.watchId) {
      if (connection.watchId !== status.watchId || !connection.clientWatchId) {
        connection.watchId = status.watchId;
        connection.clientWatchId = randomUUID();
        connection.told = null;
      }
      return { state: 'watching', watchId: connection.clientWatchId };
    }
    connection.watchId = null;
    connection.clientWatchId = null;
    return { state: status.state, watchId: null };
  }

  private sendWatch(connectionId: string, repositoryId: string, state: RepositoryWatchState, watchId: string | null): void {
    this.send({ type: 'repository.changed', repositoryId, scope: 'unknown', watch: state, ...(watchId ? { watchId } : {}) }, new Set([connectionId]));
  }
}
