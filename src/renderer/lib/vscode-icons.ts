import iconMap from '../assets/vscode-icons-map.json';
import languageMap from '../assets/vscode-language-map.json';

/**
 * The vscode-icons associations, compacted by `scripts/compact-vscode-icons.mjs`: each
 * icon (an SVG's name) lists its keys joined by `|`. A quarter of the full theme, which
 * also held the light theme's associations, never read, and a table of definitions.
 */
interface CompactIconMap {
  file: string;
  folder: string;
  folderExpanded: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  languageIds: Record<string, string>;
}

function associations(groups: Record<string, string>): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const [icon, keys] of Object.entries(groups)) for (const key of keys.split('|')) byKey.set(key, icon);
  return byKey;
}

const compact = iconMap as CompactIconMap;
const theme = {
  file: compact.file,
  folder: compact.folder,
  folderExpanded: compact.folderExpanded,
  fileExtensions: associations(compact.fileExtensions),
  fileNames: associations(compact.fileNames),
  folderNames: associations(compact.folderNames),
  languageIds: associations(compact.languageIds),
};
const languages = languageMap as { fileExtensions: Record<string, string>; fileNames: Record<string, string> };
const iconsUrl = './vscode-icons';
declare const __OPENTIG_ICONS_VERSION__: string | undefined;
/** The icons' fingerprint, from the build: a new set has new addresses, so the server serves them as immutable. */
const iconsQuery = typeof __OPENTIG_ICONS_VERSION__ === 'string' ? `?v=${__OPENTIG_ICONS_VERSION__}` : '';

export function getVsCodeFileIconUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  const fileName = lastSegment(normalizedPath);
  const directIcon = theme.fileNames.get(normalizedPath) ?? theme.fileNames.get(fileName);
  if (directIcon) return getIconUrl(directIcon);

  if (/^\.env(?:\.|$)/.test(fileName)) {
    return getIconUrl(theme.languageIds.get('dotenv') ?? theme.file);
  }

  const suffixes = getFileSuffixes(fileName);
  for (const suffix of suffixes) {
    const extensionIcon = theme.fileExtensions.get(suffix);
    if (extensionIcon) return getIconUrl(extensionIcon);
  }

  const languageId = languages.fileNames[fileName]
    ?? suffixes.map((suffix) => languages.fileExtensions[suffix]).find(Boolean);
  const languageIcon = languageId ? theme.languageIds.get(languageId) : undefined;
  return getIconUrl(languageIcon ?? theme.file);
}

export function getVsCodeLanguageIconUrl(language: string): string | null {
  const normalizedLanguage = language.trim().toLowerCase();
  const languageId = theme.languageIds.has(normalizedLanguage)
    ? normalizedLanguage
    : languages.fileExtensions[normalizedLanguage]
      ?? (normalizedLanguage === 'text' || normalizedLanguage === 'txt' ? 'plaintext' : undefined);
  const icon = languageId ? theme.languageIds.get(languageId) : undefined;
  return icon ? getIconUrl(icon) : null;
}

export function getVsCodeFolderIconUrl(path: string, expanded: boolean): string {
  const folderName = lastSegment(normalizePath(path));
  const icon = theme.folderNames.get(folderName);
  // An expanded folder's icon is its icon with `_opened`, which the compaction checks.
  return getIconUrl(icon ? (expanded ? `${icon}_opened` : icon) : expanded ? theme.folderExpanded : theme.folder);
}

function getIconUrl(icon: string): string {
  return `${iconsUrl}/${icon}.svg${iconsQuery}`;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function getFileSuffixes(fileName: string): string[] {
  const parts = fileName.split('.');
  return parts.slice(1).map((_, index) => parts.slice(index + 1).join('.'));
}
