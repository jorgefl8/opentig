import { describe, expect, it } from 'vitest';
import { announce, arrive, confirmedWatch, needsRead, NO_WATCH_TRUST, reconnected, startedUp, suspend } from './watch-trust';

describe('watch trust where each page has its own repository', () => {
  const onX = () => announce(arrive(NO_WATCH_TRUST, 'x', true), 'x', 'watching', 'c1');

  it('keeps a watch announced while the page painted what it saved, over a start-up answer that had none yet', () => {
    let state = arrive(NO_WATCH_TRUST, 'x', true);
    const arrival = state.arrival;
    // The watch was still starting when the start-up answer was written; it is announced before that answer is taken.
    state = announce(state, 'x', 'watching', 'c1');
    state = startedUp(state, 'x', arrival, undefined);
    expect(confirmedWatch(state, 'x')).toBe('c1');
  });

  it('takes the start-up answer’s watch when nothing newer was announced', () => {
    const state = arrive(NO_WATCH_TRUST, 'x', true);
    expect(confirmedWatch(startedUp(state, 'x', state.arrival, { state: 'watching', watchId: 'c1' }), 'x')).toBe('c1');
  });

  it('trusts nothing announced before leaving a repository after coming back to it', () => {
    let state = onX();
    expect(confirmedWatch(state, 'x')).toBe('c1');
    // On y, whose watch is not announced (beyond the bound, or still starting).
    state = arrive(state, 'y');
    state = arrive(state, 'x');
    expect(confirmedWatch(state, 'x')).toBeNull();
    state = announce(state, 'x', 'watching', 'c2');
    expect(confirmedWatch(state, 'x')).toBe('c2');
  });

  it('ignores news of a repository the page is not on, such as the one it just left', () => {
    let state = arrive(onX(), 'y');
    state = announce(state, 'x', 'watching', 'c3');
    state = arrive(state, 'x');
    expect(confirmedWatch(state, 'x')).toBeNull();
  });

  it('trusts nothing while a choice of another repository is on its way, and trusts again if it opened nothing', () => {
    let state = suspend(onX(), true);
    expect(confirmedWatch(state, 'x')).toBeNull();
    expect(confirmedWatch(suspend(state, false), 'x')).toBe('c1');
    // It opened elsewhere and was given up: the page asks for x again, and waits to be told of its watch.
    state = arrive(state, 'x');
    expect(confirmedWatch(state, 'x')).toBeNull();
  });

  it('does not trust again a repository the server moved the page off while a choice was on its way, once the choice fails', () => {
    // On a worktree, choosing another; the worktree is removed elsewhere, and the server says its watch is over first.
    let state = suspend(onX(), true);
    state = announce(state, 'x', 'stopped', undefined);
    state = suspend(state, false);
    expect(confirmedWatch(state, 'x')).toBeNull();
  });

  it('reads nothing more on arriving from another repository, all of whose reads follow the answer', () => {
    const state = arrive(onX(), 'y');
    expect(needsRead(state, 'y', 'watching', 'c9', false)).toBe(false);
  });

  it('reads again when the repository it shows is opened again and its watch has another id, as after picking another and coming back before its answer', () => {
    // On x under c1; another repository is picked, then x again, and the server had the page elsewhere meanwhile.
    let state = suspend(onX(), true);
    state = arrive(state, 'x');
    expect(needsRead(state, 'x', 'watching', 'c2', false)).toBe(true);
    state = announce(state, 'x', 'watching', 'c2');
    expect(confirmedWatch(state, 'x')).toBe('c2');
    // Told the same watch again, as after opening what it shows while the server never moved it: nothing to read.
    state = arrive(state, 'x');
    expect(needsRead(state, 'x', 'watching', 'c2', false)).toBe(false);
  });

  it('reads again after opening what it shows again to settle with the server, as after a choice given up', () => {
    const state = arrive(suspend(onX(), true), 'x');
    expect(needsRead(state, 'x', 'watching', 'c3', false)).toBe(true);
  });

  it('reads again when it arrived on a repository whose open did not take and opens it again before any news of its watch', () => {
    // Reads of z started as it arrived, possibly before the server had the page there.
    let state = arrive(onX(), 'z');
    state = arrive(state, 'z');
    expect(needsRead(state, 'z', 'watching', 'cz', false)).toBe(true);
  });

  it('reads nothing for a watch that stopped, which the page relies on for nothing, and always reads without the mark', () => {
    expect(needsRead(arrive(onX(), 'x'), 'x', 'stopped', undefined, false)).toBe(false);
    expect(needsRead(onX(), 'x', 'watching', 'c1', undefined)).toBe(true);
  });

  it('forgets every announcement when the connection comes back', () => {
    expect(confirmedWatch(reconnected(onX()), 'x')).toBeNull();
  });

  it('stops trusting a watch the server says has stopped', () => {
    expect(confirmedWatch(announce(onX(), 'x', 'stopped', undefined), 'x')).toBeNull();
  });
});

describe('watch trust with an older server, one repository for every client', () => {
  it('keeps an announcement for a repository, made before the page shows it, for when it does', () => {
    let state = arrive(NO_WATCH_TRUST, 'x', false);
    state = announce(state, 'y', 'watching', 'w1');
    state = arrive(state, 'y');
    expect(confirmedWatch(state, 'y')).toBe('w1');
  });
});
