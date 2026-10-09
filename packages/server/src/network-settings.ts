import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { writeFileAtomically } from '../../../src/main/persistence/atomicWrite';
import { normalizePairingOrigin, type OpenTigWebAccessPatch } from '../../../src/shared/web-access';

export interface NetworkConfig {
  webAccessEnabled: boolean;
  lanAccessEnabled: boolean;
  publicOrigin: string | null;
  listenerHost: string;
  listenerPort: number;
}

export function applyNetworkPatch(previous: NetworkConfig, input: unknown): NetworkConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid web access settings.');
  const patch = input as OpenTigWebAccessPatch;
  if (Object.keys(patch).some(key => !['webAccessEnabled', 'lanAccessEnabled', 'publicOrigin', 'listenerHost', 'listenerPort'].includes(key))) throw new Error('Unknown web access setting.');
  for (const key of ['webAccessEnabled', 'lanAccessEnabled'] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error('Invalid access switch.');
  }
  if (patch.listenerHost !== undefined && (typeof patch.listenerHost !== 'string' || !isIP(patch.listenerHost))) throw new Error('Enter an IPv4 or IPv6 listening address.');
  if (patch.listenerPort !== undefined && (!Number.isInteger(patch.listenerPort) || patch.listenerPort < 1 || patch.listenerPort > 65535)) throw new Error('Enter a port between 1 and 65535.');
  if (patch.publicOrigin !== undefined && patch.publicOrigin !== null && typeof patch.publicOrigin !== 'string') throw new Error('Invalid pairing domain.');
  const next = { ...previous, ...patch };
  if (patch.publicOrigin !== undefined) next.publicOrigin = patch.publicOrigin ? normalizePairingOrigin(patch.publicOrigin) : null;
  if (patch.lanAccessEnabled !== undefined && patch.listenerHost === undefined) next.listenerHost = patch.lanAccessEnabled ? '0.0.0.0' : '127.0.0.1';
  next.lanAccessEnabled = !isLoopbackHost(next.listenerHost);
  return next;
}

export function isLoopbackHost(host: string): boolean {
  return host === '::1' || host.startsWith('127.') || host.startsWith('::ffff:127.');
}

/** Desktop v4 remains readable; CLI settings are isolated in its private home. */
export class NetworkSettings {
  constructor(readonly filePath: string, private readonly desktop = false) {}

  async load(defaults: NetworkConfig): Promise<NetworkConfig> {
    let value: Record<string, unknown>;
    try { value = JSON.parse(await readFile(this.filePath, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
      throw new Error('Could not read web access settings. Reset access locally before restarting.', { cause: error });
    }
    if (!value || value.version !== (this.desktop ? 4 : 1)) throw new Error('Invalid web access settings version.');
    const { version: _version, ...patch } = value;
    const config = applyNetworkPatch(defaults, patch);
    // Preserve the previous desktop startup policy when migrating v4 settings.
    if (this.desktop && patch.listenerHost === undefined && !config.webAccessEnabled) config.listenerHost = defaults.listenerHost;
    return config;
  }

  save(config: NetworkConfig): Promise<void> {
    return writeFileAtomically(this.filePath, `${JSON.stringify({ version: this.desktop ? 4 : 1, ...config }, null, 2)}\n`, { parseJson: true, directoryMode: 0o700 });
  }
}
