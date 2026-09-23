import path from 'node:path';

export interface UpdateInstallation {
  profile: string;
  packaged: boolean;
  platform: string;
  version: string;
  executable: string;
  registeredDirectory: string | null;
  manifest: unknown;
}

/** Both build provenance and the per-user NSIS install registration are required. */
export function installedUpdateRepository(input: UpdateInstallation): string | null {
  if (input.profile !== 'production' || !input.packaged || input.platform !== 'win32') return null;
  if (!input.manifest || typeof input.manifest !== 'object') return null;
  const manifest = input.manifest as Record<string, unknown>;
  if (manifest.profile !== 'production' || manifest.distribution !== 'installer' || manifest.platform !== 'win32'
      || manifest.arch !== 'x64' || manifest.version !== input.version || manifest.signedRelease !== true) return null;
  const repository = manifest.updateRepository;
  if (typeof repository !== 'string' || !/^[\w-]+\/[\w.-]+$/.test(repository) || !input.registeredDirectory) return null;
  const normalize = (value: string) => path.win32.resolve(value).toLowerCase().replace(/\\+$/, '');
  if (normalize(input.registeredDirectory) !== normalize(path.win32.dirname(input.executable))) return null;
  return repository;
}
