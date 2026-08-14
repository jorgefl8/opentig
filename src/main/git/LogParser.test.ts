import { describe, expect, it } from 'vitest';
import { parseLog } from './LogParser';

describe('parseLog', () => {
  it('initializes upstream annotations as unknown', () => {
    const oid = 'a'.repeat(40);
    const parent = 'b'.repeat(40);
    const record = [oid, 'aaaaaaa', 'Subject', 'Author', 'author@example.com', '2026-07-22T09:00:00+02:00', 'HEAD -> main', parent].join('\x1f') + '\x1e';
    expect(parseLog(record)).toEqual([expect.objectContaining({ oid, upstreamState: 'unknown', isHead: false, parentCount: 1 })]);
  });
});
