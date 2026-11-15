import { useMemo, useSyncExternalStore } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { IPC } from '@shared/contracts';
import type { SerializedOperationError } from '@shared/errors';
import type { KeptRefreshOutcome } from '@shared/kept-reads';
import { GITHUB_READ_TIMEOUT_MS } from '@shared/operation-timeouts';
import { queryKeys } from './query-client';

/**
 * What is on screen from GitHub is an answer the server kept, given at `readAt`,
 * and not confirmed since: `refreshing` while the server reads it again,
 * `failed` when that read did not succeed. Absent means current.
 */
export interface KeptReadState {
  readAt: string;
  status: 'refreshing' | 'failed';
  error?: SerializedOperationError;
}

/** Answers marked as kept at once; the oldest go first. Each holds a key, a date and a timer. */
const MAX_ENTRIES = 300;
/** Past the server's own budget for the read, a refresh nobody heard back from counts as failed. */
const REFRESH_DEADLINE_MS = GITHUB_READ_TIMEOUT_MS + 15_000;

interface Entry { state: KeptReadState; timer: ReturnType<typeof setTimeout> | null }

/** Where a kept answer belongs: the query it fills, and the query to read again once it is refreshed. */
export interface KeptReadTarget {
  stateKey: QueryKey;
  invalidateKey: QueryKey;
}

/**
 * The reads the server may answer from what it kept, and the queries they fill:
 * only those shown with a `KeptReadNotice`. The branch's pull request in the top
 * bar and a stack's menu have nowhere to say so, and are always read.
 */
export function keptReadTarget(command: string, args: readonly unknown[]): KeptReadTarget | null {
  const id = String(args[0] ?? '');
  const same = (key: QueryKey): KeptReadTarget => ({ stateKey: key, invalidateKey: key });
  switch (command) {
    case IPC.githubPrView: return same(queryKeys.pullRequest(id, args[1] as number));
    case IPC.githubPrLiveState: return same(queryKeys.pullRequestLiveState(id, args[1] as number));
    case IPC.githubPrConversation: return same(queryKeys.pullRequestConversation(id, args[1] as number));
    case IPC.githubPrList: return same(queryKeys.pulls(id, args[1] as never));
    case IPC.githubPrListLineCounts: return same(queryKeys.pullLineCounts(id, args[1] as never));
    case IPC.githubPrListStacks: return same(queryKeys.pullStacks(id, args[1] as never));
    case IPC.githubReleaseList: return same(queryKeys.releases(id));
    case IPC.githubActionRunList: {
      const runs = queryKeys.actionRuns(id, (args[1] ?? null) as number | null);
      return { stateKey: [...runs, 'page', args[2] ?? 1], invalidateKey: runs };
    }
    case IPC.githubActionRunView: return same(queryKeys.actionRun(id, args[1] as number));
    default: return null;
  }
}

function keyOf(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

/** Kept answers on screen, for the notice that says so and for actions that must not act on them. */
export class KeptReads {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly refreshedListeners = new Set<(target: KeptReadTarget) => void>();
  private version = 0;

  /** An answer for `target` arrived marked as kept; `refreshed` settles when the server has read it again. */
  kept(target: KeptReadTarget, readAt: string, refreshed: Promise<KeptRefreshOutcome>): void {
    const key = keyOf(target.stateKey);
    const entry: Entry = { state: { readAt, status: 'refreshing' }, timer: null };
    entry.timer = setTimeout(() => this.settle(key, entry, { outcome: 'failed', error: { code: 'TIMEOUT', operation: 'github-read', message: 'GitHub did not answer in time.' } }), REFRESH_DEADLINE_MS);
    this.replace(key, entry);
    void refreshed.then((outcome) => {
      this.settle(key, entry, outcome);
      // The server holds the new answer now: reading it again is answered at once.
      if (outcome.outcome === 'updated') for (const listener of this.refreshedListeners) listener(target);
    });
  }

  /** A current answer for `target` arrived. */
  confirm(target: KeptReadTarget): void {
    const key = keyOf(target.stateKey);
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.entries.delete(key);
    this.changed();
  }

  /** Forgets the entries `drop` matches, such as those of an account no longer used. */
  forget(drop: (queryKey: QueryKey) => boolean): void {
    let changed = false;
    for (const [key, entry] of [...this.entries]) {
      if (!drop(JSON.parse(key) as QueryKey)) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.entries.delete(key);
      changed = true;
    }
    if (changed) this.changed();
  }

  get(queryKey: QueryKey): KeptReadState | undefined {
    return this.entries.get(keyOf(queryKey))?.state;
  }

  /** The least current of the entries under any of `prefixes`: a failure first, then the oldest. */
  summary(prefixes: readonly QueryKey[]): KeptReadState | null {
    const wanted = prefixes.map((prefix) => keyOf(prefix).slice(0, -1));
    let worst: KeptReadState | null = null;
    for (const [key, { state }] of this.entries) {
      if (!wanted.some((prefix) => key === `${prefix}]` || key.startsWith(`${prefix},`))) continue;
      if (!worst || (state.status === 'failed' && worst.status !== 'failed') || (state.status === worst.status && state.readAt < worst.readAt)) worst = state;
    }
    return worst;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  onRefreshed(listener: (target: KeptReadTarget) => void): () => void {
    this.refreshedListeners.add(listener);
    return () => this.refreshedListeners.delete(listener);
  }

  private settle(key: string, entry: Entry, outcome: KeptRefreshOutcome): void {
    if (this.entries.get(key) !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    // Updated stays `refreshing` until the query reads the new answer and confirms it.
    if (outcome.outcome === 'failed') {
      entry.state = { ...entry.state, status: 'failed', error: outcome.error };
      this.changed();
    }
  }

  private replace(key: string, entry: Entry): void {
    const previous = this.entries.get(key);
    if (previous?.timer) clearTimeout(previous.timer);
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > MAX_ENTRIES) {
      const [oldestKey, oldest] = this.entries.entries().next().value as [string, Entry];
      if (oldest.timer) clearTimeout(oldest.timer);
      this.entries.delete(oldestKey);
    }
    this.changed();
  }

  private changed(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

export const keptReads = new KeptReads();

/** The least current of the kept answers under `prefixes`, or null when all of them are current. */
export function useKeptRead(prefixes: readonly QueryKey[], store: KeptReads = keptReads): KeptReadState | null {
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const key = JSON.stringify(prefixes);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `prefixes`, and `version` for the store's content.
  return useMemo(() => store.summary(prefixes), [store, key, version]);
}
