/** Stop JSON.stringify before it builds an oversized wire message. */
export class JsonByteLimitError extends Error {}

export function stringifyBounded(value: unknown, maxBytes: number): { text: string; bytes: number } {
  let bytes = 0;
  let root = true;
  const populated = new WeakSet<object>();
  const add = (count: number) => {
    bytes += count;
    if (bytes > maxBytes) throw new JsonByteLimitError('JSON byte limit exceeded.');
  };
  const text = JSON.stringify(value, function (key, entry: unknown): unknown {
    if (entry instanceof Number || entry instanceof String || entry instanceof Boolean) entry = entry.valueOf();
    // The native serializer has already applied toJSON. Omitted object values
    // do not occupy bytes; the same values in an array become null.
    const omitted = entry === undefined || typeof entry === 'function' || typeof entry === 'symbol';
    const isRoot = root;
    root = false;
    if (omitted && !Array.isArray(this)) return entry;
    if (!isRoot) {
      if (populated.has(this)) add(1); // comma
      else populated.add(this);
      if (!Array.isArray(this)) add(stringBytes(key, maxBytes - bytes) + 1); // key and colon
    }
    if (typeof entry === 'string') add(stringBytes(entry, maxBytes - bytes));
    else if (entry === null || omitted) add(4);
    else if (typeof entry === 'number') add(Number.isFinite(entry) ? String(entry).length : 4);
    else if (typeof entry === 'boolean') add(entry ? 4 : 5);
    else if (typeof entry === 'object') {
      add(2); // braces or brackets
      populated.delete(entry); // repeated references serialize independently
    }
    return entry;
  });
  if (text === undefined) throw new TypeError('Expected a JSON value.');
  return { text, bytes };
}

function stringBytes(value: string, remaining: number): number {
  // Count without allocating an escaped copy. UTF-8 bytes are a lower bound,
  // so huge strings can be rejected by the caller without scanning escapes.
  let bytes = Buffer.byteLength(value) + 2;
  if (bytes > remaining) throw new JsonByteLimitError('JSON byte limit exceeded.');
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 1;
    else if (code < 0x20) bytes += 5;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      else bytes += 3; // escaped lone surrogate replaces three UTF-8 bytes
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 3;
    if (bytes > remaining) throw new JsonByteLimitError('JSON byte limit exceeded.');
  }
  return bytes;
}
