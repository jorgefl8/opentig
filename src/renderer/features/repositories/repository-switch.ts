import type { RepositoryInfo } from '@shared/contracts';

export interface RepositorySwitchHandlers {
  /** Opens a recent repository; null means the user cancelled (for example, a relocation prompt). */
  open(id: string): Promise<RepositoryInfo | null>;
  apply(repository: RepositoryInfo, id: string): void;
  fail(reason: unknown): void;
  pending(id: string | null): void;
}

export interface RepositorySwitcher {
  /** Supplies the latest handlers; call it before the first selection and whenever they change. */
  connect(handlers: RepositorySwitchHandlers): void;
  select(id: string, currentId: string | null): Promise<void>;
  /** Whether a repository activated elsewhere may replace the current one right now. */
  accepts(repositoryId: string): boolean;
}

/**
 * Opening a repository also makes it the backend's active repository, so
 * parallel opens could finish out of order and leave the backend and the UI on
 * different repositories. Only one open runs at a time; a newer choice replaces
 * any queued one, so both always end on the latest choice.
 */
export function createRepositorySwitcher(): RepositorySwitcher {
  let current: RepositorySwitchHandlers | null = null;
  const handlers = () => {
    if (!current) throw new Error('Repository switching is not connected.');
    return current;
  };
  let target: string | null = null;
  let running = false;
  return {
    connect: (next) => { current = next; },
    accepts: (repositoryId) => target === null || repositoryId === target,
    async select(id, currentId) {
      if (!running && id === currentId) return;
      target = id;
      handlers().pending(id);
      if (running) return;
      running = true;
      try {
        while (target !== null) {
          const next: string = target;
          try {
            const repository = await handlers().open(next);
            if (repository && target === next) handlers().apply(repository, next);
          } catch (reason) {
            if (target === next) handlers().fail(reason);
          }
          if (target === next) target = null;
        }
      } finally {
        running = false;
        handlers().pending(null);
      }
    },
  };
}
