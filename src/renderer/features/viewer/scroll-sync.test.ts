import { describe, expect, it } from 'vitest';
import { syncScrollFraction, type ScrollSyncTarget } from './scroll-sync';

/** Drives the sync frame by frame so growth and user input can be scripted. */
function createHarness(initial: { contentHeight: number; viewport: number }) {
  const frames: (() => void)[] = [];
  const state = { ...initial, scrollTop: 0 };
  const applied: number[] = [];
  const target: ScrollSyncTarget = {
    getScrollRange: () => Math.max(0, state.contentHeight - state.viewport),
    getScrollTop: () => state.scrollTop,
    getContentHeight: () => state.contentHeight,
    scrollTo: (top) => { state.scrollTop = top; applied.push(top); },
  };
  const options = {
    requestFrame: (callback: () => void) => frames.push(callback),
    cancelFrame: () => { frames.length = 0; },
  };
  const advance = (count = 1) => {
    for (let index = 0; index < count; index += 1) {
      const next = frames.shift();
      if (!next) return;
      next();
    }
  };
  return { state, applied, target, options, advance, pending: () => frames.length };
}

describe('syncScrollFraction', () => {
  it('applies the fraction immediately and follows content that keeps growing', () => {
    const harness = createHarness({ contentHeight: 1_000, viewport: 500 });
    syncScrollFraction(harness.target, 0.5, harness.options);

    expect(harness.state.scrollTop).toBe(250);

    harness.state.contentHeight = 3_000;
    harness.advance();
    expect(harness.state.scrollTop).toBe(1_250);

    harness.state.contentHeight = 5_000;
    harness.advance();
    expect(harness.state.scrollTop).toBe(2_250);
  });

  it('stops once the content height holds steady', () => {
    const harness = createHarness({ contentHeight: 2_000, viewport: 500 });
    syncScrollFraction(harness.target, 1, harness.options);

    harness.advance(10);
    expect(harness.state.scrollTop).toBe(1_500);
    expect(harness.pending()).toBe(0);
  });

  it('gives up the scroll as soon as the user moves it', () => {
    const harness = createHarness({ contentHeight: 4_000, viewport: 500 });
    syncScrollFraction(harness.target, 0.25, harness.options);
    expect(harness.state.scrollTop).toBe(875);

    harness.state.scrollTop = 3_000;
    harness.advance();

    expect(harness.state.scrollTop).toBe(3_000);
    expect(harness.pending()).toBe(0);
  });

  it('keeps waiting while the target reports no content yet', () => {
    const harness = createHarness({ contentHeight: 0, viewport: 500 });
    syncScrollFraction(harness.target, 0.5, harness.options);

    harness.advance(6);
    expect(harness.pending()).toBe(1);

    harness.state.contentHeight = 2_500;
    harness.advance(5);
    expect(harness.state.scrollTop).toBe(1_000);
    expect(harness.pending()).toBe(0);
  });

  it('scrolls to the top when the content does not overflow', () => {
    const harness = createHarness({ contentHeight: 200, viewport: 500 });
    syncScrollFraction(harness.target, 0.8, harness.options);

    expect(harness.state.scrollTop).toBe(0);
  });

  it('clamps fractions outside 0-1 and treats non-finite values as the top', () => {
    const overflowing = createHarness({ contentHeight: 1_500, viewport: 500 });
    syncScrollFraction(overflowing.target, 4, overflowing.options);
    expect(overflowing.state.scrollTop).toBe(1_000);

    const invalid = createHarness({ contentHeight: 1_500, viewport: 500 });
    syncScrollFraction(invalid.target, Number.NaN, invalid.options);
    expect(invalid.state.scrollTop).toBe(0);
  });

  it('stops reapplying once cancelled', () => {
    const harness = createHarness({ contentHeight: 1_000, viewport: 500 });
    const cancel = syncScrollFraction(harness.target, 0.5, harness.options);

    cancel();
    harness.state.contentHeight = 4_000;
    harness.advance(5);

    expect(harness.state.scrollTop).toBe(250);
  });

  it('never runs longer than the frame budget', () => {
    const harness = createHarness({ contentHeight: 1_000, viewport: 500 });
    syncScrollFraction(harness.target, 0.5, { ...harness.options, maxFrames: 4 });

    // The height changes every frame, so only the budget can end the loop.
    for (let index = 0; index < 20; index += 1) {
      harness.state.contentHeight += 100;
      harness.advance();
    }

    expect(harness.applied).toHaveLength(4);
    expect(harness.pending()).toBe(0);
  });
});
