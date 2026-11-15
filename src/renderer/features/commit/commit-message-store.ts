import { useSyncExternalStore } from 'react';

/**
 * The text of the commit box. It lives outside React state so that typing
 * redraws the box alone: the app around it reads the text when it needs it, to
 * commit or to fill it in, and is not redrawn by every key.
 */
export interface CommitMessageStore {
  get(): string;
  set(message: string): void;
  subscribe(listener: () => void): () => void;
}

export function createCommitMessageStore(initial = ''): CommitMessageStore {
  let message = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => message,
    set: (next) => {
      if (next === message) return;
      message = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export function useCommitMessage(store: CommitMessageStore): string {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
