export const DEFAULT_DOUBLE_CONTROL_INTERVAL_MS = 400;

export class DoubleControlDetector {
  private readonly pressedControlKeys = new Set<number>();
  private currentPressIsStandalone = true;
  private lastStandaloneReleaseAt: number | null = null;

  constructor(
    private readonly onDoubleControl: () => void,
    private readonly intervalMs = DEFAULT_DOUBLE_CONTROL_INTERVAL_MS,
  ) {}

  keyDown(keycode: number, isControl: boolean, occurredAt: number): void {
    if (!isControl) {
      this.currentPressIsStandalone = false;
      this.lastStandaloneReleaseAt = null;
      return;
    }

    if (this.pressedControlKeys.has(keycode)) return;
    if (this.pressedControlKeys.size === 0) this.currentPressIsStandalone = true;
    this.pressedControlKeys.add(keycode);

    if (this.lastStandaloneReleaseAt !== null
      && occurredAt - this.lastStandaloneReleaseAt > this.intervalMs) {
      this.lastStandaloneReleaseAt = null;
    }
  }

  keyUp(keycode: number, isControl: boolean, occurredAt: number): void {
    if (!isControl || !this.pressedControlKeys.delete(keycode)) return;
    if (this.pressedControlKeys.size > 0) return;

    if (!this.currentPressIsStandalone) {
      this.lastStandaloneReleaseAt = null;
      return;
    }

    if (this.lastStandaloneReleaseAt !== null
      && occurredAt - this.lastStandaloneReleaseAt <= this.intervalMs) {
      this.lastStandaloneReleaseAt = null;
      this.onDoubleControl();
      return;
    }

    this.lastStandaloneReleaseAt = occurredAt;
  }
}
