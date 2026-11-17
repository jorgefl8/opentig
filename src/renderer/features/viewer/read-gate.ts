/**
 * Lets at most `limit` reads run at once, so unfolding hundreds of files asks
 * the server for a few at a time instead of all of them together. The others
 * wait their turn in the order they asked, except an urgent one, such as a file
 * the user unfolded alone, which goes ahead of the rest. A read given up while
 * it waits never starts.
 */
export function createReadGate(limit: number) {
  let running = 0;
  const waiting: Array<{ urgent: boolean; start(): void }> = [];
  const next = () => {
    while (running < limit && waiting.length) {
      running += 1;
      waiting.shift()!.start();
    }
  };
  return function run<T>(read: () => Promise<T>, signal: AbortSignal, urgent = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('The read was cancelled.', 'AbortError'));
        return;
      }
      const leave = () => {
        const index = waiting.indexOf(item);
        if (index < 0) return;
        waiting.splice(index, 1);
        reject(new DOMException('The read was cancelled.', 'AbortError'));
      };
      const item = {
        urgent,
        start: () => {
          signal.removeEventListener('abort', leave);
          let reading: Promise<T>;
          try { reading = read(); } catch (error) { reading = Promise.reject(error); }
          void reading.then(resolve, reject).finally(() => {
            running -= 1;
            next();
          });
        },
      };
      signal.addEventListener('abort', leave, { once: true });
      const before = urgent ? waiting.findIndex((other) => !other.urgent) : -1;
      if (before < 0) waiting.push(item);
      else waiting.splice(before, 0, item);
      next();
    });
  };
}
