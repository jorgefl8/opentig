import { types } from 'node:util';

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
    // Match native wrapper coercion: Number/String use primitive conversion,
    // while Boolean reads its internal value. Prototype inheritance alone does
    // not make an object a wrapper, and an overridden valueOf is not sufficient.
    if (typeof entry === 'object' && entry !== null && types.isBoxedPrimitive(entry)) {
      if (types.isNumberObject(entry)) entry = +(entry as unknown as number);
      else if (types.isStringObject(entry)) entry = String(entry);
      else if (types.isBooleanObject(entry)) entry = Boolean.prototype.valueOf.call(entry);
    }
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
  // Count escaped text in bounded native-serializer chunks instead of walking
  // every code unit in JavaScript. Keep surrogate pairs together at boundaries.
  // oxlint-disable-next-line eslint/no-control-regex
  if (!/[\u0000-\u001f"\\\ud800-\udfff]/.test(value)) return bytes;
  bytes = 2;
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 16_384, value.length);
    const previous = value.charCodeAt(end - 1), next = value.charCodeAt(end);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end++;
    bytes += Buffer.byteLength(JSON.stringify(value.slice(start, end))) - 2;
    if (bytes > remaining) throw new JsonByteLimitError('JSON byte limit exceeded.');
    start = end;
  }
  return bytes;
}
