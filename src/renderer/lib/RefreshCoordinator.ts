export interface RefreshRequest<Scope> {
  scope: Scope;
  background: boolean;
}

interface PendingRefresh<Scope> extends RefreshRequest<Scope> {
  generation: number;
  waiters: Array<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  }>;
}

export class RefreshCoordinator<Scope> {
  private running = false;
  private generation = 0;
  private pending: PendingRefresh<Scope> | null = null;

  constructor(
    private readonly execute: (request: RefreshRequest<Scope>) => Promise<void>,
    private readonly mergeScope: (left: Scope, right: Scope) => Scope,
  ) {}

  request(request: RefreshRequest<Scope>): Promise<void> {
    const generation = this.generation;
    const promise = new Promise<void>((resolve, reject) => {
      if (this.pending?.generation === generation) {
        this.pending.scope = this.mergeScope(this.pending.scope, request.scope);
        this.pending.background = this.pending.background && request.background;
        this.pending.waiters.push({ resolve, reject });
      } else {
        this.pending = { ...request, generation, waiters: [{ resolve, reject }] };
      }
    });
    void this.drain();
    return promise;
  }

  invalidate(): void {
    this.generation += 1;
    const pending = this.pending;
    this.pending = null;
    pending?.waiters.forEach(({ resolve }) => resolve());
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const current = this.pending;
        this.pending = null;
        if (current.generation !== this.generation) {
          current.waiters.forEach(({ resolve }) => resolve());
          continue;
        }
        try {
          await this.execute({ scope: current.scope, background: current.background });
          current.waiters.forEach(({ resolve }) => resolve());
        } catch (reason) {
          current.waiters.forEach(({ reject }) => reject(reason));
        }
      }
    } finally {
      this.running = false;
      if (this.pending) void this.drain();
    }
  }
}
