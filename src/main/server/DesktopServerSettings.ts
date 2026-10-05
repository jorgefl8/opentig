import { readFile } from 'node:fs/promises';
import { writeFileAtomically } from '../persistence/atomicWrite';
import { normalizePairingOrigin } from '../../shared/web-access';

interface PersistedDesktopServerSettings {
  version: 4;
  webAccessEnabled: boolean;
  lanAccessEnabled: boolean;
  publicOrigin: string | null;
}

export type DesktopServerConfig = Omit<PersistedDesktopServerSettings, 'version'>;

/** Desktop-only network exposure state. Server domain settings never own it. */
export class DesktopServerSettings {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<DesktopServerConfig> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, unknown> | null;
      if ((value?.version === 1 || value?.version === 2 || value?.version === 3)
        && typeof value.webAccessEnabled === 'boolean') {
        return { webAccessEnabled: value.webAccessEnabled, lanAccessEnabled: value.webAccessEnabled, publicOrigin: null };
      }
      if (value?.version === 4 && typeof value.webAccessEnabled === 'boolean' && typeof value.lanAccessEnabled === 'boolean'
        && (value.publicOrigin === null || typeof value.publicOrigin === 'string')) {
        return { webAccessEnabled: value.webAccessEnabled, lanAccessEnabled: value.lanAccessEnabled, publicOrigin: value.publicOrigin === null ? null : normalizePairingOrigin(value.publicOrigin) };
      }
      return defaults();
    } catch {
      return defaults();
    }
  }

  save(config: DesktopServerConfig): Promise<void> {
    if (typeof config.webAccessEnabled !== 'boolean' || typeof config.lanAccessEnabled !== 'boolean') throw new Error('Invalid web access settings.');
    const value: PersistedDesktopServerSettings = { version: 4, ...config, publicOrigin: config.publicOrigin === null ? null : normalizePairingOrigin(config.publicOrigin) };
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
  return { webAccessEnabled: false, lanAccessEnabled: false, publicOrigin: null };
}
