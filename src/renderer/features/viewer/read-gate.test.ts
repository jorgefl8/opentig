import { describe, expect, it } from 'vitest';
import { createReadGate } from './read-gate';

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('the read gate', () => {
  it('runs a few reads at once, lets an urgent one ahead of those waiting, and never starts one given up', async () => {
    const run = createReadGate(2);
    const started: string[] = [];
    const reads = new Map<string, ReturnType<typeof deferred>>();
    const ask = (name: string, signal = new AbortController().signal, urgent = false) => run(() => {
      started.push(name);
      const read = deferred();
      reads.set(name, read);
      return read.promise;
    }, signal, urgent);

    const first = ask('a');
    void ask('b');
    const dropped = new AbortController();
    const given = ask('c', dropped.signal);
    void ask('d');
    void ask('urgent', new AbortController().signal, true);
    expect(started).toEqual(['a', 'b']);

    dropped.abort();
    await expect(given).rejects.toMatchObject({ name: 'AbortError' });
    reads.get('a')!.resolve('A');
    expect(await first).toBe('A');
    await Promise.resolve();
    expect(started).toEqual(['a', 'b', 'urgent']);
    reads.get('b')!.resolve('B');
    await new Promise((done) => setTimeout(done, 0));
    expect(started).toEqual(['a', 'b', 'urgent', 'd']);
  });
});
