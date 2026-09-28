import { describe, expect, it } from 'vitest';
import { selectHistoryBase } from './HistoryBase';

const oid = 'a'.repeat(40);
const ref = (name: string, target = '') => `${name}\0${oid}\0${target}`;
describe('history base refs', () => {
  it('uses the upstream remote default, including custom branch and remote names', () => {
    const output = [ref('refs/remotes/origin/HEAD', 'refs/remotes/origin/main'), ref('refs/remotes/team/upstream/HEAD', 'refs/remotes/team/upstream/trunk')].join('\n');
    expect(selectHistoryBase(output, 'team/upstream/feature')).toEqual({ ref: 'team/upstream/trunk', oid });
  });
  it('prefers the published base over an unpushed local main', () => {
    expect(selectHistoryBase([ref('refs/heads/main'), ref('refs/remotes/origin/main')].join('\n'), 'origin/feature')?.ref).toBe('origin/main');
  });
  it('uses local main when no remote default is known and remains unknown for other names', () => {
    expect(selectHistoryBase(ref('refs/heads/main'), null)?.ref).toBe('main');
    expect(selectHistoryBase(ref('refs/heads/feature'), null)).toBeNull();
    expect(selectHistoryBase('refs/remotes/origin/HEAD\0invalid\0refs/remotes/origin/main', null)).toBeNull();
  });
});
