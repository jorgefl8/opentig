import { describe, expect, it } from 'vitest';
import { parsePerformanceAutomationSteps } from './PerformanceAutomation';

describe('parsePerformanceAutomationSteps', () => {
  it('validates, normalizes and sorts steps', () => {
    const steps = parsePerformanceAutomationSteps(JSON.stringify([
      { atMs: 5000, label: ' Markdown / Hot ', action: { type: 'refresh' } },
      { atMs: 1000, settleMs: 2500, action: { type: 'selection', selection: null } },
    ]));

    expect(steps).toEqual([
      { atMs: 1000, settleMs: 2500, label: 'step-2', action: { type: 'selection', selection: null } },
      { atMs: 5000, settleMs: 1500, label: 'markdown-hot', action: { type: 'refresh' } },
    ]);
  });

  it('rejects malformed, excessive and out-of-range input as a whole', () => {
    expect(parsePerformanceAutomationSteps('{')).toEqual([]);
    expect(parsePerformanceAutomationSteps(JSON.stringify([{ atMs: -1, action: {} }]))).toEqual([]);
    expect(parsePerformanceAutomationSteps(JSON.stringify(Array.from({ length: 101 }, () => ({ atMs: 1, action: {} }))))).toEqual([]);
  });
});
