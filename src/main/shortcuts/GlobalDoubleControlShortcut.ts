import { UiohookKey, uIOhook } from 'uiohook-napi';
import { DoubleControlDetector } from './DoubleControlDetector';

const controlKeys = new Set<number>([UiohookKey.Ctrl, UiohookKey.CtrlRight]);

export function startGlobalDoubleControlShortcut(onTrigger: () => void): () => void {
  const detector = new DoubleControlDetector(onTrigger);
  const onKeyDown = (event: { keycode: number; time: number }) => {
    detector.keyDown(event.keycode, controlKeys.has(event.keycode), event.time);
  };
  const onKeyUp = (event: { keycode: number; time: number }) => {
    detector.keyUp(event.keycode, controlKeys.has(event.keycode), event.time);
  };

  uIOhook.on('keydown', onKeyDown);
  uIOhook.on('keyup', onKeyUp);
  uIOhook.start();

  return () => {
    uIOhook.off('keydown', onKeyDown);
    uIOhook.off('keyup', onKeyUp);
    uIOhook.stop();
  };
}
