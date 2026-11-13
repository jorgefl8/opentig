import { describe, expect, it, vi } from 'vitest';
import { createColorHoverController } from './color-hover-controller';

function setup() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers = {
    setTimeout: (callback: () => void) => { next += 1; pending.set(next, callback); return next; },
    clearTimeout: (handle: unknown) => { pending.delete(handle as number); },
  };
  const flush = () => { for (const [handle, callback] of [...pending]) { pending.delete(handle); callback(); } };
  const onChange = vi.fn();
  const controller = createColorHoverController<{ key: string }>({ delayMs: 300, onChange, timers });
  return { controller, onChange, flush, pending };
}

describe('createColorHoverController', () => {
  it('shows a color after the pointer rests on it', () => {
    const { controller, onChange, flush } = setup();
    controller.update({ key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
    flush();
    expect(onChange).toHaveBeenCalledWith({ key: 'a' });
  });

  it('does not restart the wait while the pointer stays on the same color', () => {
    const { controller, pending } = setup();
    controller.update({ key: 'a' });
    controller.update({ key: 'a' });
    expect(pending.size).toBe(1);
  });

  it('cancels a pending color when the pointer leaves first', () => {
    const { controller, onChange, flush } = setup();
    controller.update({ key: 'a' });
    controller.update(null);
    flush();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('restarts the wait for a different color before anything shows', () => {
    const { controller, onChange, flush, pending } = setup();
    controller.update({ key: 'a' });
    controller.update({ key: 'b' });
    expect(pending.size).toBe(1);
    flush();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ key: 'b' });
  });

  it('switches at once between colors and hides at once', () => {
    const { controller, onChange, flush } = setup();
    controller.update({ key: 'a' });
    flush();
    controller.update({ key: 'a' });
    controller.update({ key: 'b' });
    expect(onChange).toHaveBeenLastCalledWith({ key: 'b' });
    controller.update(null);
    expect(onChange).toHaveBeenLastCalledWith(null);
    controller.update(null);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('stops pending work on dispose', () => {
    const { controller, onChange, pending } = setup();
    controller.update({ key: 'a' });
    controller.dispose();
    expect(pending.size).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
