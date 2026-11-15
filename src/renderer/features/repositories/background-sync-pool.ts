export interface BackgroundSyncPool {
  /**
   * Asks for each repository to be synced. One that is already waiting or
   * running is left alone, unless `afterChange` says its state has just
   * changed: then it runs once more when the current run ends.
   */
  request(repositoryIds: Iterable<string>, afterChange?: boolean): void;
}

/**
 * Syncs repositories a few at a time. Each sync holds a server request for as
 * long as its remote takes to answer, so one per saved repository at once
 * would leave no room for the repository the user is opening.
 */
export function createBackgroundSyncPool(concurrency: number, sync: (repositoryId: string) => Promise<void>): BackgroundSyncPool {
  const waiting: string[] = [];
  const running = new Set<string>();
  const repeat = new Set<string>();

  const next = () => {
    while (running.size < concurrency && waiting.length > 0) {
      const repositoryId = waiting.shift()!;
      running.add(repositoryId);
      void sync(repositoryId).catch(() => undefined).finally(() => {
        running.delete(repositoryId);
        if (repeat.delete(repositoryId)) waiting.push(repositoryId);
        next();
      });
    }
  };

  return {
    request(repositoryIds, afterChange = false) {
      for (const repositoryId of repositoryIds) {
        if (running.has(repositoryId)) {
          if (afterChange) repeat.add(repositoryId);
        } else if (!waiting.includes(repositoryId)) waiting.push(repositoryId);
      }
      next();
    },
  };
}
