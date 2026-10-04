import { PointerSensor } from '@dnd-kit/core';

/** Touch and pen gestures belong to native scrolling, even on wide screens. */
export class MouseDragSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators = PointerSensor.activators.map((activator) => ({
    ...activator,
    handler: (event: Parameters<typeof activator.handler>[0], options: Parameters<typeof activator.handler>[1]) => event.nativeEvent.pointerType === 'mouse'
      && activator.handler(event, options),
  }));
}
