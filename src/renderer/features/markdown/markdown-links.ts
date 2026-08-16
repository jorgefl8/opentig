export function resolveMarkdownRepositoryPath(markdownPath: string, href: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;

  const rawPath = value.split(/[?#]/, 1)[0];
  if (!rawPath) return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath).replaceAll('\\', '/');
  } catch {
    return null;
  }

  const resolved = decodedPath.startsWith('/')
    ? []
    : markdownPath.replaceAll('\\', '/').split('/').slice(0, -1).filter(Boolean);
  for (const segment of decodedPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    if (hasControlCharacter(segment)) return null;
    resolved.push(segment);
  }
  return resolved.length > 0 ? resolved.join('/') : null;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
