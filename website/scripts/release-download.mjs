import { readFile } from 'node:fs/promises';
import { latestReleasePage, windowsInstaller } from '../src/lib/downloads.ts';

export const latestReleaseUrl = 'https://api.github.com/repos/jorgefl8/opentig/releases/latest';

/**
 * Resolve the installer that production HTML carries before any script runs, so
 * crawlers and visitors without JavaScript see the current release. Only the
 * version and URL are baked in; scan identity stays a live browser concern.
 *
 * `releaseFile` is GitHub's latest-release JSON fetched by the deploy workflow,
 * which keeps credentials out of the build and makes a bad release fail the
 * deployment. Without it, the build asks GitHub anonymously and links to the
 * latest-release page when that is unavailable.
 */
export async function buildDownload({ releaseFile, fetcher = globalThis.fetch, warn = () => {} } = {}) {
  if (releaseFile) {
    const download = windowsInstaller(JSON.parse(await readFile(releaseFile, 'utf8')));
    if (!download) throw new Error(`${releaseFile} is not a stable release with exactly one uploaded Windows installer.`);
    return { version: download.version, url: download.url };
  }
  try {
    const response = await fetcher(latestReleaseUrl, {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const download = windowsInstaller(await response.json());
    if (!download) throw new Error('the latest release has no matching Windows installer');
    return { version: download.version, url: download.url };
  } catch (error) {
    warn(`Linking to the latest release page: ${error instanceof Error ? error.message : error}.`);
    return latestReleasePage;
  }
}
