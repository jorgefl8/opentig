interface ByteBudgetLruOptions<Value> {
  maxEntries: number;
  maxBytes: number;
  sizeOf(value: Value): number;
}

interface Entry<Value> {
  value: Value;
  bytes: number;
}

export class ByteBudgetLru<Key, Value> {
  private readonly entries = new Map<Key, Entry<Value>>();
  private totalBytes = 0;

  constructor(private readonly options: ByteBudgetLruOptions<Value>) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new RangeError('maxEntries must be a positive integer.');
    }
    if (!Number.isFinite(options.maxBytes) || options.maxBytes < 1) {
      throw new RangeError('maxBytes must be a positive number.');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value): boolean {
    const bytes = normalizeSize(this.options.sizeOf(value));
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.totalBytes -= previous.bytes;
    }
    if (bytes > this.options.maxBytes) return false;

    this.entries.set(key, { value, bytes });
    this.totalBytes += bytes;
    this.evictToBudget();
    return this.entries.has(key);
  }

  delete(key: Key): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private evictToBudget(): void {
    while (this.entries.size > this.options.maxEntries || this.totalBytes > this.options.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }
}

function normalizeSize(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('sizeOf must return a finite, non-negative number.');
  return Math.ceil(value);
}
