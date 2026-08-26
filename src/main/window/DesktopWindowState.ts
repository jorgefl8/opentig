import { readFile } from 'node:fs/promises';
import { writeFileAtomically } from '../persistence/atomicWrite';

export interface DesktopWindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_BOUNDS: DesktopWindowBounds = { width: 1280, height: 800, isMaximized: false };

/** Desktop-owned bounds with a read-only fallback from the former shared settings file. */
export class DesktopWindowState {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly legacySettingsPath: string,
  ) {}

  async load(): Promise<DesktopWindowBounds> {
    const current = await readBounds(this.filePath, false);
    if (current) return current;
    const legacy = await readBounds(this.legacySettingsPath, true);
    return legacy ?? { ...DEFAULT_BOUNDS };
  }

  save(bounds: DesktopWindowBounds): Promise<void> {
    const normalized = normalizeBounds(bounds) ?? { ...DEFAULT_BOUNDS };
    const write = this.pendingWrite.then(async () => {
      await writeFileAtomically(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, { parseJson: true });
    });
    this.pendingWrite = write.catch(() => undefined);
    return write;
  }

  flush(): Promise<void> {
    return this.pendingWrite;
  }
}

/** BrowserWindow constructor options: size and position only, never the maximized flag. */
export function browserWindowBounds(state: DesktopWindowBounds): {
  width: number;
  height: number;
  x?: number;
  y?: number;
} {
  return {
    width: state.width,
    height: state.height,
    ...(state.x != null ? { x: state.x } : {}),
    ...(state.y != null ? { y: state.y } : {}),
  };
}

/**
 * Drop x/y when the restored rectangle does not intersect any display work area
 * (unplugged monitor). Electron then centers on the current display.
 */
export function boundsVisibleOnDisplays(
  bounds: { width: number; height: number; x?: number; y?: number },
  workAreas: readonly DisplayWorkArea[],
): { width: number; height: number; x?: number; y?: number } {
  const { width, height, x, y } = bounds;
  if (x == null || y == null || workAreas.length === 0) return { width, height, ...(x != null ? { x } : {}), ...(y != null ? { y } : {}) };
  const visible = workAreas.some((area) => (
    x < area.x + area.width
    && x + width > area.x
    && y < area.y + area.height
    && y + height > area.y
  ));
  if (visible) return { width, height, x, y };
  return { width, height };
}

async function readBounds(filePath: string, nested: boolean): Promise<DesktopWindowBounds | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = nested ? (parsed as Record<string, unknown>).windowBounds : parsed;
    return normalizeBounds(candidate);
  } catch {
    return null;
  }
}

function normalizeBounds(value: unknown): DesktopWindowBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bounds = value as Record<string, unknown>;
  if (typeof bounds.width !== 'number' || !Number.isFinite(bounds.width)
    || typeof bounds.height !== 'number' || !Number.isFinite(bounds.height)) return null;
  return {
    width: Math.max(900, Math.round(bounds.width)),
    height: Math.max(600, Math.round(bounds.height)),
    ...(typeof bounds.x === 'number' && Number.isFinite(bounds.x) ? { x: Math.round(bounds.x) } : {}),
    ...(typeof bounds.y === 'number' && Number.isFinite(bounds.y) ? { y: Math.round(bounds.y) } : {}),
    isMaximized: bounds.isMaximized === true,
  };
}
