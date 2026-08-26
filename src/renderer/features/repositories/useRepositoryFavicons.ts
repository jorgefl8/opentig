import { useEffect, useState } from 'react';
import { opentig } from '@/lib/opentig-api';

export function useRepositoryFavicons(repositories: ReadonlyArray<{ key: string; recent: { id: string } }>): ReadonlyMap<string, string> {
  const [favicons, setFavicons] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const seen = new Set<string>();
    void Promise.all(repositories.map(async (item) => {
      if (seen.has(item.key)) return;
      seen.add(item.key);
      try {
        const favicon = await opentig.repository.getFavicon(item.recent.id);
        if (cancelled || !favicon) return;
        setFavicons((current) => {
          if (current.get(item.key) === favicon.dataUrl) return current;
          const next = new Map(current);
          next.set(item.key, favicon.dataUrl);
          return next;
        });
      } catch {
        // Missing or unreadable icons stay absent; the name still identifies the repo.
      }
    }));
    return () => { cancelled = true; };
  }, [repositories]);

  return favicons;
}
