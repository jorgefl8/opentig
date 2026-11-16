import type { RepositoryInfo } from '@shared/contracts';

export interface RepositorySwitchHandlers {
  /** Opens a recent repository; null means the user cancelled (for example, a relocation prompt). */
  open(id: string): Promise<RepositoryInfo | null>;
  apply(repository: RepositoryInfo, id: string): void;
  /**
   * The switching ended with the server on a repository that is not shown: a choice given up, or
   * replaced by one that then failed, opened anyway. Called once, with the last one opened.
   */
  abandoned?(repository: RepositoryInfo): void;
  fail(reason: unknown): void;
  pending(id: string | null): void;
}

/** How one choice ended: opened, replaced by a later choice, given up, or failed. `current` was already open. */
export type RepositorySwitchOutcome = 'opened' | 'current' | 'superseded' | 'cancelled' | 'failed';

export interface RepositorySwitcher {
  /** Supplies the latest handlers; call it before the first selection and whenever they change. */
  connect(handlers: RepositorySwitchHandlers): void;
  /**
   * Opens a repository. The call that starts the switching resolves once it is
   * over; a call made while it runs resolves once its own choice has ended.
   */
  select(id: string, currentId: string | null): Promise<RepositorySwitchOutcome>;
  /**
   * Gives up the choice waiting or running: if its repository still opens on the
   * server, it is not shown, and its announcement from the server is refused.
   */
  cancel(): void;
  /** Whether a repository activated elsewhere may replace the current one right now. */
  accepts(repositoryId: string): boolean;
  /** No choice is waiting or on its way. */
  idle(): boolean;
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
  /** The open on its way, and one given up while on its way, whose announcement is refused. */
  let inFlight: string | null = null;
  let abandoned: string | null = null;
  let waiter: ((outcome: RepositorySwitchOutcome) => void) | null = null;
  const settle = (outcome: RepositorySwitchOutcome) => {
    const resolve = waiter;
    waiter = null;
    resolve?.(outcome);
  };
  return {
    connect: (next) => { current = next; },
    accepts: (repositoryId) => repositoryId !== abandoned && (target === null || repositoryId === target),
    idle: () => !running && target === null,
    cancel() {
      if (target === null) return;
      abandoned = inFlight;
      target = null;
      settle('cancelled');
      handlers().pending(null);
    },
    async select(id, currentId) {
      if (!running && id === currentId) return 'current';
      settle('superseded');
      const outcome = new Promise<RepositorySwitchOutcome>((resolve) => { waiter = resolve; });
      target = id;
      if (abandoned === id) abandoned = null;
      handlers().pending(id);
      if (running) return outcome;
      running = true;
      /** What the server last opened in this run, while it is not what is shown. */
      let leftOnServer: RepositoryInfo | null = null;
      try {
        while (target !== null) {
          const next: string = target;
          inFlight = next;
          try {
            const repository = await handlers().open(next);
            if (repository) leftOnServer = repository;
            if (target === next) {
              if (repository) {
                handlers().apply(repository, next);
                leftOnServer = null;
              }
              settle(repository ? 'opened' : 'cancelled');
            }
          } catch (reason) {
            if (target === next) {
              handlers().fail(reason);
              settle('failed');
            }
          }
          if (target === next) target = null;
          // The server announces an opened repository before it answers, so nothing of it can still arrive.
          inFlight = null;
          if (abandoned === next) abandoned = null;
        }
      } finally {
        running = false;
        if (leftOnServer) handlers().abandoned?.(leftOnServer);
        handlers().pending(null);
      }
      return outcome;
    },
  };
}
