import { describe, expect, it } from 'vitest';
import type { PullRequestCheck, PullRequestLiveState } from '@shared/contracts';
import { pullRequestChecksSentence, releaseStateTone } from './gh-utils';

const check = (result: PullRequestCheck['result']): PullRequestCheck => ({ name: result, workflow: null, result, required: false, url: null });
const checks = (rollup: PullRequestLiveState['checks']['rollup'], results: PullRequestCheck['result'][], truncated = false): PullRequestLiveState['checks'] => ({ rollup, items: results.map(check), truncated, partial: false });

describe('pullRequestChecksSentence', () => {
  it.each([
    ['failures', checks('FAILING', ['fail', 'pass', 'pass']), '1 of 3 checks failing'],
    ['approvals waiting among failures', checks('FAILING', ['fail', 'action-required', 'pass']), '2 of 3 checks need attention'],
    ['running checks', checks('PENDING', ['pending', 'pass']), '1 of 2 checks running'],
    ['passes, leaving out what was skipped', checks('PASSING', ['pass', 'pass', 'skipped']), '2 checks passed'],
    ['a single pass', checks('PASSING', ['pass']), '1 check passed'],
  ])('counts %s', (_name, value, sentence) => {
    expect(pullRequestChecksSentence(value)).toBe(sentence);
  });

  it.each([
    ['a truncated list', checks('FAILING', ['fail', 'pass'], true), 'Checks failing'],
    ['a rollup without its items', checks('PENDING', []), 'Checks pending'],
    ['only skipped checks', checks('PASSING', ['skipped']), 'Checks passing'],
  ])('claims no count for %s', (_name, value, sentence) => {
    expect(pullRequestChecksSentence(value)).toBe(sentence);
  });
});

describe('releaseStateTone', () => {
  it.each([
    [{ isDraft: true, isPrerelease: false, isLatest: false }, 'attention'],
    [{ isDraft: false, isPrerelease: false, isLatest: true }, 'ready'],
    [{ isDraft: false, isPrerelease: true, isLatest: false }, 'neutral'],
    [{ isDraft: false, isPrerelease: false, isLatest: false }, 'neutral'],
  ])('colours %o', (release, tone) => {
    expect(releaseStateTone(release)).toBe(tone);
  });
});
