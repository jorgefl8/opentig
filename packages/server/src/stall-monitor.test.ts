import { afterEach, describe, expect, it, vi } from 'vitest';
import { startStallMonitor } from './stall-monitor';

afterEach(() => { vi.useRealTimers(); });

describe('startStallMonitor', () => {
  it('reports only a pause long enough to matter', async () => {
    vi.useFakeTimers();
    let time = 0;
    const logger = vi.fn();
    const stop = startStallMonitor(logger, () => time);

    time += 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    time += 3_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logger).not.toHaveBeenCalled();

    time += 46_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logger).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledWith('warn', expect.stringContaining('unresponsive for 45000 ms'));

    stop();
    time += 46_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logger).toHaveBeenCalledOnce();
  });
});
