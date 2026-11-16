import { describe, expect, it } from 'vitest';
import { CUT_LIFETIME_MS, MAX_CUTS_PER_SESSION, PendingCuts } from './PendingCuts';

const same = (left: readonly string[], right: readonly string[]) => left.join('\n') === right.join('\n');

describe('PendingCuts', () => {
  it('keeps each cut of a session by its transfer id, and gives one only once, for its repository and files', () => {
    const cuts = new PendingCuts();
    cuts.add('session', 'first', { repositoryId: 'repo', paths: ['/repo/a.txt'] });
    cuts.add('session', 'second', { repositoryId: 'repo', paths: ['/repo/b.txt'] });
    expect(cuts.take('session', 'first', 'other-repo', ['/repo/a.txt'], same)).toBeNull();
    expect(cuts.take('session', 'first', 'repo', ['/repo/b.txt'], same)).toBeNull();
    expect(cuts.take('another-session', 'first', 'repo', ['/repo/a.txt'], same)).toBeNull();
    expect(cuts.take('session', 'first', 'repo', ['/repo/a.txt'], same)).toMatchObject({ paths: ['/repo/a.txt'] });
    expect(cuts.take('session', 'first', 'repo', ['/repo/a.txt'], same)).toBeNull();
    expect(cuts.take('session', 'second', 'repo', ['/repo/b.txt'], same)).not.toBeNull();
  });

  it('lets a cut expire, and keeps only the newest of a session', () => {
    let now = 0;
    const cuts = new PendingCuts(() => now);
    cuts.add('session', 'old', { repositoryId: 'repo', paths: ['/repo/old.txt'] });
    now = CUT_LIFETIME_MS;
    expect(cuts.take('session', 'old', 'repo', ['/repo/old.txt'], same)).toBeNull();
    for (let index = 0; index <= MAX_CUTS_PER_SESSION; index += 1) cuts.add('session', `cut-${index}`, { repositoryId: 'repo', paths: [`/repo/${index}`] });
    expect(cuts.take('session', 'cut-0', 'repo', ['/repo/0'], same)).toBeNull();
    expect(cuts.take('session', `cut-${MAX_CUTS_PER_SESSION}`, 'repo', [`/repo/${MAX_CUTS_PER_SESSION}`], same)).not.toBeNull();
  });
});
