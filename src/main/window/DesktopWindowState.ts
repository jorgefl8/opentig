import { readFile } from 'node:fs/promises';
import { writeFileAtomically } from '../persistence/atomicWrite';

export interface DesktopWindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

const DEFAULT_BOUNDS: DesktopWindowBounds = { width: 1280, height: 800 };

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
  };
}
