/** Path navigation uses the backend's syntax, independently of the browser OS. */
export function folderBreadcrumbs(path: string): { name: string; path: string }[] {
  const separator = path.includes('\\') ? '\\' : '/';
  const normalized = path.replace(/\\/g, '/');
  const unc = normalized.match(/^\/\/[^/]+\/[^/]+/);
  const drive = normalized.match(/^[A-Za-z]:\//);
  const root = unc?.[0] ?? drive?.[0] ?? '/';
  const rootPath = root.replace(/\//g, separator);
  const crumbs = [{ name: unc ? rootPath : drive ? root.slice(0, 2) : '/', path: rootPath }];
  let prefix = root.replace(/\/$/, '');
  for (const name of normalized.slice(root.length).split('/').filter(Boolean)) {
    prefix += '/' + name;
    crumbs.push({ name, path: prefix.replace(/\//g, separator) });
  }
  return crumbs;
}

export function parentFolderPath(path: string): string | null {
  const crumbs = folderBreadcrumbs(path);
  return crumbs.length > 1 ? crumbs[crumbs.length - 2]!.path : null;
}

export function folderName(path: string): string {
  return folderBreadcrumbs(path).at(-1)?.name ?? path;
}

export function sameFolder(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const path = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return /^(?:[A-Za-z]:|\/\/)/.test(path) ? path.toLowerCase() : path;
  };
  return normalize(a) === normalize(b);
}
