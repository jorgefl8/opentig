import { randomUUID } from 'node:crypto';
import type { ClientAttachment, RecentRepository, RepositoryInfo } from '../../shared/contracts';
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
  /**
   * Answers to opens still on their way to it. Meanwhile it hears nothing of its watch: it is told
   * once each answer has gone, so what it is told comes after the answer and before its reads.
   */
  answering: number;
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
    this.connections.set(connectionId, { repository: null, watchId: null, told: null, clientWatchId: null, started: 0, attached: 0, answering: 0 });
    return true;
  }

  /** The connection closed or died: its repository is released, after the pool's grace period. */
  disconnect(connectionId: string): void {
    if (!this.connections.delete(connectionId)) return;
    this.pool.release(connectionId);
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
   * The connection now has `repository` open, unless a later open, a move or a bootstrap on it took
   * effect first. Once the answer to the open is on its way (`afterAnswer`), the connection is told
   * the repository it left is no longer watched for it, and how the one it has is, even when that
   * did not change: the client forgets what it was told whenever it opens a repository. Those come
   * after the answer and before any read the client makes on it, so they need no read (`refresh: false`).
   * An answer that itself says how the repository is watched, as the bootstrap's does (see `watch`),
   * is not followed by the same news.
   */
  attach(connectionId: string | undefined, repository: RepositoryInfo, ticket: number, options: { afterAnswer?: (task: () => void) => void } = {}): ClientAttachment {
    const connection = connectionId === undefined ? undefined : this.connections.get(connectionId);
    if (!connectionId || !connection) return { attached: false, repositoryId: null, ticket: 0 };
    if (ticket < connection.attached) return this.attachment(connection, false);
    connection.attached = ticket;
    const left = connection.repository && connection.repository.id !== repository.id && connection.told && connection.told !== 'stopped'
      ? connection.repository.id : null;
    if (connection.repository?.id !== repository.id) {
      connection.watchId = null;
      connection.clientWatchId = null;
    }
    connection.told = null;
    connection.repository = repository;
    connection.answering += 1;
    this.pool.hold(connectionId, repository);
    const tell = () => {
      connection.answering -= 1;
      if (this.connections.get(connectionId) !== connection) return;
      if (left && connection.repository?.id !== left) this.sendWatch(connectionId, left, 'stopped', null, false);
      if (connection.answering === 0 && connection.repository) this.announce(connectionId, connection, false);
    };
    if (options.afterAnswer) options.afterAnswer(tell);
    else tell();
    return this.attachment(connection, true);
  }

  /** Where the server has the connection, for an answer (see `ClientAttachment`). */
  private attachment(connection: ClientConnection, attached: boolean): ClientAttachment {
    return { attached, repositoryId: connection.repository?.id ?? null, ticket: connection.attached };
  }

  /** Tells the connection how its repository is watched, unless it was already told so. */
  private announce(connectionId: string, connection: ClientConnection, refresh?: false): void {
    const watch = this.watchOf(connectionId, connection);
    if (!watch || watch.state === connection.told) return;
    connection.told = watch.state;
    this.sendWatch(connectionId, connection.repository!.id, watch.state, watch.watchId, refresh);
  }

  /**
   * How the connection's repository is watched, as the connection is to know it, for an answer that
   * says so; undefined while it is being set up. Read last, with nothing awaited after it, so no
   * newer announcement can go out before the answer that carries this one.
   */
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
  move(fromIds: Iterable<string>, repository: RepositoryInfo, details: { reason: 'removed' | 'relocated'; recentRepositories: RecentRepository[]; except?: string | undefined }): void {
    const from = new Set(fromIds);
    for (const [id, connection] of this.connections) {
      if (id === details.except || !connection.repository || !from.has(connection.repository.id)) continue;
      const previousId = connection.repository.id;
      // First that what it relied on is over, whatever it does with the move: it may be choosing another repository.
      if (connection.told && connection.told !== 'stopped') this.sendWatch(id, previousId, 'stopped', null, false);
      connection.told = null;
      const ticket = this.beginOpen(id);
      this.send({ type: 'repository.active-changed', repository, previousId, reason: details.reason, recentRepositories: details.recentRepositories, ticket }, new Set([id]));
      this.attach(id, repository, ticket);
    }
  }

  /** A change to the repository, for the connections that have it open. */
  changed(repositoryId: string, scope: RepositoryChangeScope): void {
    const recipients = this.connectionsOn(repositoryId);
    if (recipients.size > 0) this.send({ type: 'repository.changed', repositoryId, scope }, recipients);
  }

  /**
   * The pool's watch of the repository went from one state to another. One stopped on purpose for a
   * while (`paused`), as before its folder is deleted, needs no read: one that starts again is told with one.
   */
  watchChanged(repositoryId: string, state: RepositoryWatchState, watchId: string | null, paused?: boolean): void {
    for (const [id, connection] of this.connections) {
      // Only a connection the pool counts on the repository is told it is watched; one waiting for an
      // answer is told once that has gone.
      if (connection.repository?.id !== repositoryId || this.pool.heldBy(id) !== repositoryId || connection.answering > 0) continue;
      if (state === 'watching' && watchId) {
        connection.watchId = watchId;
        connection.clientWatchId = randomUUID();
      } else {
        connection.watchId = null;
        connection.clientWatchId = null;
      }
      connection.told = state;
      this.sendWatch(id, repositoryId, state, connection.clientWatchId, paused ? false : undefined);
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

  private sendWatch(connectionId: string, repositoryId: string, state: RepositoryWatchState, watchId: string | null, refresh?: false): void {
    this.send({ type: 'repository.changed', repositoryId, scope: 'unknown', watch: state, ...(watchId ? { watchId } : {}), ...(refresh === false ? { refresh } : {}) }, new Set([connectionId]));
  }
}
