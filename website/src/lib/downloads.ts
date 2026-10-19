import type { InstallerScan } from './installer-scan';
import { scanFromNotes } from './installer-scan-notes.ts';

export type InstallerIdentity = {
  repository: 'jorgefl8/opentig';
  version: string;
  releaseId: number;
  assetId: number;
  name: string;
  size: number;
  sha256: string;
};

export type WindowsDownload = {
  version: string;
  url: string;
  identity?: InstallerIdentity;
  scan?: InstallerScan;
};

// No scan identity is inferred from the static fallback's version or filename.
export const fallbackDownload: WindowsDownload = {
  version: 'v0.2.4',
  url: 'https://github.com/jorgefl8/opentig/releases/download/v0.2.4/OpenTig-0.2.4-win32-x64-Setup.exe',
};

export function windowsInstaller(release: unknown): WindowsDownload | undefined {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return;
  const { id: releaseId, tag_name: tag, draft, prerelease, assets, body } = release as Record<string, unknown>;
  if (draft !== false || prerelease !== false || typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag) || !Array.isArray(assets)) return;
  const name = `OpenTig-${tag.slice(1)}-win32-x64-Setup.exe`;
  const url = `https://github.com/jorgefl8/opentig/releases/download/${tag}/${name}`;
  const matches = assets.filter(asset => asset?.name === name);
  if (matches.length !== 1) return;
  const asset = matches[0];
  if (asset.state !== 'uploaded' || asset.browser_download_url !== url) return;
  const download: WindowsDownload = { version: tag, url };
  if (positiveInteger(releaseId) && positiveInteger(asset.id) && positiveInteger(asset.size)
    && typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    download.identity = {
      repository: 'jorgefl8/opentig', version: tag, releaseId, assetId: asset.id,
      name, size: asset.size, sha256: asset.digest.slice(7),
    };
    const scan = scanFromNotes(body, download);
    if (scan) download.scan = scan;
  }
  return download;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

let latest: Promise<WindowsDownload> | undefined;
export function latestDownload(): Promise<WindowsDownload> {
  return latest ??= fetch('https://api.github.com/repos/jorgefl8/opentig/releases/latest', {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/vnd.github+json' },
  }).then(async response => response.ok ? windowsInstaller(await response.json()) ?? fallbackDownload : fallbackDownload)
    .catch(() => fallbackDownload);
}
