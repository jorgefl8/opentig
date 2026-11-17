interface Generation {
  invalidated: boolean;
  flights: Map<string, Promise<unknown>>;
}

/** Shares pending attempts only; invalidated results/errors get at most two retries, then the last attempt settles the read. */
export class ReadSingleFlight {
  private readonly generations = new Map<string, Generation>();

  invalidate(scope: string): void {
    const generation = this.generations.get(scope);
    if (generation) generation.invalidated = true;
    this.generations.delete(scope);
  }

  clear(): void {
    for (const scope of this.generations.keys()) this.invalidate(scope);
  }

  /**
   * `startNew` never joins a read already under way, which may predate what the
   * caller is asking about; later readers join the new one instead.
   */
  async run<T>(scope: string, key: string, read: () => Promise<T>, retryInvalidated = true, startNew = false): Promise<T> {
    // Retry outside the shared promise. Joining a newer consumer must not inherit
    // its fresh retry budget and extend an older request indefinitely.
    for (let attempt = 0; ; attempt++) {
      // The last attempt started after the previous change, so a repository that
      // keeps changing still gets its newest read; that change publishes its own refresh.
      const settle = !retryInvalidated || attempt === 2;
      // A retry follows a change made after the first attempt started, so any read under way by then is new enough.
      const { generation, promise } = this.pending(scope, key, read, startNew && attempt === 0);
      try {
        const value = await promise;
        if (!generation.invalidated || settle) return value;
      } catch (error) {
        if (!generation.invalidated || settle) throw error;
      }
    }
  }

  private pending<T>(scope: string, key: string, read: () => Promise<T>, startNew: boolean): { generation: Generation; promise: Promise<T> } {
    let generation = this.generations.get(scope);
    if (!generation) {
      generation = { invalidated: false, flights: new Map() };
      this.generations.set(scope, generation);
    }
    const existing = generation.flights.get(key);
    if (existing && !startNew) return { generation, promise: existing as Promise<T> };
    const current = generation;
    const release = () => {
      if (current.flights.get(key) === promise) current.flights.delete(key);
      if (!current.flights.size && this.generations.get(scope) === current) this.generations.delete(scope);
    };
    const promise = Promise.resolve().then(read).then(
      value => { release(); return value; },
      (error: unknown) => { release(); throw error; },
    );
    current.flights.set(key, promise);
    return { generation, promise };
  }
}
