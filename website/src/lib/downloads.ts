// Last verified stable installer, available even without JavaScript or GitHub API access.
export const fallbackDownload = {
  version: 'v0.2.3',
  url: 'https://github.com/jorgefl8/opentig/releases/download/v0.2.3/OpenTig-0.2.3-win32-x64-Setup.exe',
};

export function windowsInstaller(release: unknown): typeof fallbackDownload | undefined {
  if (!release || typeof release !== 'object') return;
  const { tag_name: tag, draft, prerelease, assets } = release as Record<string, unknown>;
  if (draft !== false || prerelease !== false || typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag) || !Array.isArray(assets)) return;
  const name = `OpenTig-${tag.slice(1)}-win32-x64-Setup.exe`;
  const url = `https://github.com/jorgefl8/opentig/releases/download/${tag}/${name}`;
  const asset = assets.find(asset => asset?.name === name && asset?.state === 'uploaded' && asset?.browser_download_url === url);
  if (asset) return { version: tag, url };
}

let latest: Promise<typeof fallbackDownload> | undefined;
export function latestDownload(): Promise<typeof fallbackDownload> {
  return latest ??= fetch('https://api.github.com/repos/jorgefl8/opentig/releases/latest', {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/vnd.github+json' },
  }).then(async response => response.ok ? windowsInstaller(await response.json()) ?? fallbackDownload : fallbackDownload)
    .catch(() => fallbackDownload);
}
