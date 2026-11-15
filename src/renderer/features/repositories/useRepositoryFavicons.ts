import { useEffect, useSyncExternalStore } from 'react';
import { opentig } from '@/lib/opentig-api';
import { inBackground } from '@/lib/websocket-transport';

// Kept for the session and shared by every list of repositories: the lists are
// rebuilt on each repository switch, and asking again for every saved
// repository each time would crowd out the requests of the one being opened.
let favicons: ReadonlyMap<string, string> = new Map();
/** Repositories already answered, with or without an icon, or being asked about. */
const requested = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(key: string, repositoryId: string): void {
  if (requested.has(key)) return;
  requested.add(key);
  inBackground(() => opentig.repository.getFavicon(repositoryId)).then((favicon) => {
    // Missing icons stay absent; the name still identifies the repo.
    if (!favicon || favicons.get(key) === favicon.dataUrl) return;
    favicons = new Map(favicons).set(key, favicon.dataUrl);
    for (const listener of listeners) listener();
  }, () => {
    // An icon that could not be read is asked for again the next time a list shows the repository.
    requested.delete(key);
  });
}

export function useRepositoryFavicons(repositories: ReadonlyArray<{ key: string; recent: { id: string } }>): ReadonlyMap<string, string> {
  useEffect(() => {
    for (const item of repositories) load(item.key, item.recent.id);
  }, [repositories]);

  return useSyncExternalStore(subscribe, () => favicons);
}
