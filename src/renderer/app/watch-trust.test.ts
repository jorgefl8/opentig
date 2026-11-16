import { describe, expect, it } from 'vitest';
import { announce, arrive, confirmedWatch, NO_WATCH_TRUST, reconnected, startedUp, suspend } from './watch-trust';

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
