/**
 * The toolbar doubles as the window title bar, so it has to leave room for the
 * native window controls Electron draws on top of it.
 */
export interface TitlebarAreaRect {
  x: number;
  width: number;
}

export interface WindowControlsInset {
  left: number;
  right: number;
}

/** Width of the Windows/Linux minimize, maximize and close buttons at 100% zoom. */
const OVERLAY_CONTROLS_WIDTH = 138;
/** Width reserved for the macOS traffic lights placed at `trafficLightPosition`. */
const TRAFFIC_LIGHTS_WIDTH = 78;

/**
 * Measures how much horizontal space the window controls take. The measured
 * title bar area is preferred because it follows zoom and DPI changes; the
 * per-platform constants are the fallback for when the Window Controls Overlay
 * API is unavailable, which still leaves the controls clickable.
 */
export function resolveWindowControlsInset(input: {
  rect: TitlebarAreaRect | null;
  viewportWidth: number;
  mac: boolean;
}): WindowControlsInset {
  const { rect, viewportWidth, mac } = input;
  if (rect && rect.width > 0) {
    return {
      left: Math.max(0, Math.round(rect.x)),
      right: Math.max(0, Math.round(viewportWidth - rect.x - rect.width)),
    };
  }
  return mac ? { left: TRAFFIC_LIGHTS_WIDTH, right: 0 } : { left: 0, right: OVERLAY_CONTROLS_WIDTH };
}
