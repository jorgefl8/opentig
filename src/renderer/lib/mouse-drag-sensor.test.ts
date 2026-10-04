import { describe, expect, it, vi } from 'vitest';
import { MouseDragSensor } from './mouse-drag-sensor';

describe('mouse dragging', () => {
  const activate = (pointerType: string, button = 0, isPrimary = true) => {
    const onActivation = vi.fn();
    const handler = MouseDragSensor.activators[0]!.handler;
    const accepted = handler({ nativeEvent: { pointerType, button, isPrimary } } as Parameters<typeof handler>[0], { onActivation });
    return { accepted, onActivation };
  };

  it.each(['touch', 'pen'])('leaves %s gestures available for native scrolling', (type) => {
    const result = activate(type);
    expect(result.accepted).toBe(false);
    expect(result.onActivation).not.toHaveBeenCalled();
  });

  it('retains left mouse dragging and rejects secondary buttons/pointers', () => {
    expect(activate('mouse').accepted).toBe(true);
    expect(activate('mouse').onActivation).toHaveBeenCalledOnce();
    expect(activate('mouse', 2).accepted).toBe(false);
    expect(activate('mouse', 0, false).accepted).toBe(false);
  });
});
