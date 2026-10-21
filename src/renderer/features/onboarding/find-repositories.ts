import type { ServerDirectoryListing } from '@shared/contracts';
import { normalizeRepositoryKey } from '@shared/repository-projects';

export interface FoundRepository { name: string; path: string; branch: string | null; location: string }

// Folders people commonly keep checkouts in, relative to the home folder.
const CONTAINERS = ['code', 'projects', 'src', 'source', 'dev', 'developer', 'development', 'git', 'github', 'gitlab', 'repos', 'repositories', 'workspace', 'workspaces', 'work', 'sites', 'documents'];
const MAX_LISTINGS = 30;

/**
 * Looks for repositories in the home folder, in common checkout folders, next
 * to repositories already added, and one level inside those (for example
 * ~/code/client/app). Uses the same read-only folder listing as the Open
 * dialog, so nothing is modified.
 */
export async function findRepositories(browse: (path?: string) => Promise<ServerDirectoryListing>, known: string[], signal?: AbortSignal): Promise<FoundRepository[]> {
  const skip = new Set(known.map(normalizeRepositoryKey));
  const found = new Map<string, FoundRepository>();
  let listings = 0;
  const list = async (path?: string) => {
    if (listings >= MAX_LISTINGS || signal?.aborted) return null;
    listings += 1;
    try { return await browse(path); } catch { return null; }
  };
  const collect = (listing: ServerDirectoryListing) => {
    for (const folder of listing.directories) {
      const key = normalizeRepositoryKey(folder.path);
      if (folder.repository && !skip.has(key) && !found.has(key)) found.set(key, { name: folder.name, path: folder.path, branch: folder.repository.branch, location: listing.path });
    }
  };
  const containers = (listing: ServerDirectoryListing) => listing.directories.filter(folder => !folder.repository && CONTAINERS.includes(folder.name.toLowerCase()));

  const home = await list();
  if (!home) return [];
  collect(home);
  // People keep checkouts together, so the folders holding known repositories are good places to look.
  const homeKey = normalizeRepositoryKey(home.path) + '/';
  // Hidden folders such as ~/.cache or tool-managed worktree folders are not where people keep projects.
  const siblings = known.map(parentOf).filter((parent): parent is string => parent !== null && (normalizeRepositoryKey(parent) + '/').startsWith(homeKey)
    && normalizeRepositoryKey(parent) + '/' !== homeKey && !/[\\/]\./.test(parent.slice(homeKey.length - 1)));
  const folders = [...new Map([...containers(home).map(folder => folder.path), ...siblings].map(path => [normalizeRepositoryKey(path), path])).values()];
  const first = (await Promise.all(folders.map(path => list(path)))).filter(value => value !== null);
  first.forEach(collect);
  // One level deeper, but only below the checkout folders found above.
  const nested = first.flatMap(listing => listing.directories.filter(folder => !folder.repository && !folder.name.startsWith('.')));
  for (let index = 0; index < nested.length && listings < MAX_LISTINGS; index += 4) {
    const batch = await Promise.all(nested.slice(index, index + 4).map(folder => list(folder.path)));
    batch.forEach(listing => { if (listing) collect(listing); });
  }
  signal?.throwIfAborted();
  return [...found.values()].sort((left, right) => left.location.localeCompare(right.location) || left.name.localeCompare(right.name));
}

function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index > 0 ? trimmed.slice(0, index) : null;
}
