type Loader<Name extends string, Value> = Record<Name, () => Promise<Value>>;

export class LazyLanguageLoader<Name extends string, Value> {
  private readonly inFlight = new Map<Name, Promise<void>>();

  constructor(private readonly loaders: Loader<Name, Value>) {}

  async ensure(
    name: Name,
    isLoaded: () => boolean,
    register: (value: Value) => Promise<void>,
  ): Promise<void> {
    if (isLoaded()) return;
    const existing = this.inFlight.get(name);
    if (existing) return existing;

    const pending = this.loaders[name]()
      .then(register)
      .finally(() => {
        if (this.inFlight.get(name) === pending) this.inFlight.delete(name);
      });
    this.inFlight.set(name, pending);
    return pending;
  }
}
