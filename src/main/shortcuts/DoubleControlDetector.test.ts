import { describe, expect, it, vi } from 'vitest';
import { DoubleControlDetector } from './DoubleControlDetector';

const CTRL = 29;
const C = 46;

function tapControl(detector: DoubleControlDetector, downAt: number, upAt: number): void {
  detector.keyDown(CTRL, true, downAt);
  detector.keyUp(CTRL, true, upAt);
}

describe('DoubleControlDetector', () => {
  it('triggers after two standalone Control taps within the interval', () => {
    const onTrigger = vi.fn();
    const detector = new DoubleControlDetector(onTrigger, 400);

    tapControl(detector, 100, 140);
    tapControl(detector, 300, 340);

    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('does not trigger when the taps are too far apart', () => {
    const onTrigger = vi.fn();
    const detector = new DoubleControlDetector(onTrigger, 400);

    tapControl(detector, 100, 140);
    tapControl(detector, 600, 640);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('ignores key repeat while Control is held', () => {
    const onTrigger = vi.fn();
    const detector = new DoubleControlDetector(onTrigger, 400);

    detector.keyDown(CTRL, true, 100);
    detector.keyDown(CTRL, true, 120);
    detector.keyUp(CTRL, true, 140);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('does not treat a Control chord as a standalone tap', () => {
    const onTrigger = vi.fn();
    const detector = new DoubleControlDetector(onTrigger, 400);

    detector.keyDown(CTRL, true, 100);
    detector.keyDown(C, false, 120);
    detector.keyUp(C, false, 130);
    detector.keyUp(CTRL, true, 140);
    tapControl(detector, 250, 280);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('requires another pair after triggering', () => {
    const onTrigger = vi.fn();
    const detector = new DoubleControlDetector(onTrigger, 400);

    tapControl(detector, 100, 120);
    tapControl(detector, 200, 220);
    tapControl(detector, 300, 320);

    expect(onTrigger).toHaveBeenCalledOnce();
  });
});
