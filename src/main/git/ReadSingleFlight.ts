interface Generation {
  invalidated: boolean;
  flights: Map<string, Promise<unknown>>;
}

/** Shares pending reads only. Invalidated results/errors retry in the current generation. */
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

  run<T>(scope: string, key: string, read: () => Promise<T>, retryInvalidated = true): Promise<T> {
    let generation = this.generations.get(scope);
    if (!generation) {
      generation = { invalidated: false, flights: new Map() };
      this.generations.set(scope, generation);
    }
    const existing = generation.flights.get(key);
    if (existing) return existing as Promise<T>;
    const current = generation;
    const promise = Promise.resolve().then(read).then(
      (value) => current.invalidated && retryInvalidated ? this.run(scope, key, read, retryInvalidated) : value,
      (error: unknown) => {
        if (current.invalidated && retryInvalidated) return this.run(scope, key, read, retryInvalidated);
        throw error;
      },
    ).finally(() => {
      if (current.flights.get(key) === promise) current.flights.delete(key);
      if (!current.flights.size && this.generations.get(scope) === current) this.generations.delete(scope);
    });
    current.flights.set(key, promise);
    return promise;
  }
}
