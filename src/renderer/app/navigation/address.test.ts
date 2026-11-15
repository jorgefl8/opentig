import { describe, expect, it } from 'vitest';
import { addressOf, locationOf, parseAddress } from './address';
import type { NavigationLocation } from './location';

const OID = 'a'.repeat(40);
const at = (location: Partial<NavigationLocation>): NavigationLocation => ({ repositoryId: 'r1', view: 'files', selection: null, fileHistory: null, line: null, pane: 'viewer', ...location });
const read = (address: string) => {
  const url = new URL(address, 'http://opentig.test');
  return parseAddress(url.pathname, url.search, url.hash);
};

describe('addresses', () => {
  it('read back as the place they were written for, whatever the path holds', () => {
    const places: NavigationLocation[] = [
      at({ view: 'changes', selection: { type: 'diff', path: 'src/a b#c?.ts', kind: 'staged' } }),
      at({ view: 'files', selection: { type: 'file', path: 'docs/ñandú %20.md' }, line: 40 }),
      at({ view: 'history', selection: { type: 'commit-file', oid: OID, path: 'new/name.ts', oldPath: 'old/name.ts' }, fileHistory: { path: 'new/name.ts', returnTo: { view: 'history', selection: null } } }),
      at({ view: 'prs', selection: { type: 'release', tag: 'release/v1.2.0' } }),
      at({ view: 'prs', selection: { type: 'workflow-run', runId: 9_007_199_254_740_991, jobId: 12 } }),
      at({ view: 'search', selection: null, pane: 'list' }),
    ];
    for (const place of places) {
      const parsed = read(addressOf(place));
      expect(parsed.kind, addressOf(place)).toBe('target');
      if (parsed.kind !== 'target') continue;
      const back = locationOf(parsed.target);
      expect({ ...back, fileHistory: back.fileHistory?.path ?? null }).toEqual({ ...place, fileHistory: place.fileHistory?.path ?? null });
    }
    const pull = read(addressOf(at({ view: 'prs', selection: { type: 'pull-request', number: 24 } }), 'code'));
    expect(pull.kind === 'target' && pull.target.pullTab).toBe('code');
  });

  it('refuse paths that leave the worktree or reach into Git’s own folder', () => {
    for (const address of [
      '/r/r1/file/..%2F..%2Fetc%2Fpasswd', '/r/r1/file/src/../../etc/passwd', '/r/r1/file//etc/passwd', '/r/r1/file/src%5C..%5Csecret',
      '/r/r1/file/C:%2Fwindows', '/r/r1/file/.git/config', '/r/r1/file/a%00b', '/r/r1/changes/staged/../x', '/r/r1/commit/' + OID + '/file/..%2Fx',
      '/r/r1/history?history-of=../x', '/r/r1/commit/' + OID + '/file/x?from=..%2Fy', '/r/r1/file/%E0%A4%A',
    ]) expect(read(address).kind, address).toBe('malformed');
  });

  it('refuse ids, numbers and tags that are not what they claim to be', () => {
    for (const address of [
      '/r/r1/commit/abc123', '/r/r1/commit/' + 'A'.repeat(40), '/r/r1/pr/0', '/r/r1/pr/24x', '/r/r1/pr/99999999999', '/r/r1/pr/24/files',
      '/r/r1/run/1e3', '/r/r1/run/5/job/-1', '/r/r1/release/--upload-pack=x', '/r/r1/release/v1..2', '/r/r1/release/a%20b', '/r/r1/release/x.lock',
      '/r/r%20x/files', '/r/r1/file/a#L0', '/r/r1/file/a#L12abc', '/r/r1/unknown', '/r/r1/files/extra',
    ]) expect(read(address).kind, address).toBe('malformed');
    expect(read('/').kind).toBe('none');
    expect(read('/pair').kind).toBe('none');
  });
});
