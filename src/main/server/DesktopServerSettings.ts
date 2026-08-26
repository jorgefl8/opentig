import { readFile } from 'node:fs/promises';
import { writeFileAtomically } from '../persistence/atomicWrite';

interface PersistedDesktopServerSettings {
  version: 3;
  webAccessEnabled: boolean;
}

export type DesktopServerConfig = Pick<PersistedDesktopServerSettings, 'webAccessEnabled'>;

/** Desktop-only network exposure state. Server domain settings never own it. */
export class DesktopServerSettings {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<DesktopServerConfig> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, unknown> | null;
      if ((value?.version === 1 || value?.version === 2 || value?.version === 3)
        && typeof value.webAccessEnabled === 'boolean') {
        return { webAccessEnabled: value.webAccessEnabled };
      }
      return defaults();
    } catch {
      return defaults();
    }
  }

  save(config: DesktopServerConfig): Promise<void> {
    const value: PersistedDesktopServerSettings = { version: 3, ...config };
    const write = this.pendingWrite.then(async () => {
      await writeFileAtomically(this.filePath, `${JSON.stringify(value, null, 2)}\n`, { parseJson: true });
    });
    this.pendingWrite = write.catch(() => undefined);
    return write;
  }

  flush(): Promise<void> {
    return this.pendingWrite;
  }
}

function defaults(): DesktopServerConfig {
  return { webAccessEnabled: false };
}
