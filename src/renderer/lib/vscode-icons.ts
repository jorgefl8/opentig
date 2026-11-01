import iconTheme from '../assets/vscode-icons-theme.json';
import languageMap from '../assets/vscode-language-map.json';

interface IconThemeManifest {
  iconDefinitions: Record<string, { iconPath: string }>;
  file: string;
  folder: string;
  folderExpanded: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  languageIds: Record<string, string>;
}

const theme = iconTheme as IconThemeManifest;
const languages = languageMap as { fileExtensions: Record<string, string>; fileNames: Record<string, string> };
const iconsUrl = './vscode-icons';

export function getVsCodeFileIconUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  const fileName = lastSegment(normalizedPath);
  const directIcon = theme.fileNames[normalizedPath] ?? theme.fileNames[fileName];
  if (directIcon) return getIconUrl(directIcon);

  if (/^\.env(?:\.|$)/.test(fileName)) {
    return getIconUrl(theme.languageIds.dotenv ?? theme.file);
  }

  const suffixes = getFileSuffixes(fileName);
  for (const suffix of suffixes) {
    const extensionIcon = theme.fileExtensions[suffix];
    if (extensionIcon) return getIconUrl(extensionIcon);
  }

  const languageId = languages.fileNames[fileName]
    ?? suffixes.map((suffix) => languages.fileExtensions[suffix]).find(Boolean);
  const languageIcon = languageId ? theme.languageIds[languageId] : undefined;
  return getIconUrl(languageIcon ?? theme.file);
}

export function getVsCodeLanguageIconUrl(language: string): string | null {
  const normalizedLanguage = language.trim().toLowerCase();
  const languageId = theme.languageIds[normalizedLanguage]
    ? normalizedLanguage
    : languages.fileExtensions[normalizedLanguage]
      ?? (normalizedLanguage === 'text' || normalizedLanguage === 'txt' ? 'plaintext' : undefined);
  const icon = languageId ? theme.languageIds[languageId] : undefined;
  return icon ? getIconUrl(icon) : null;
}

export function getVsCodeFolderIconUrl(path: string, expanded: boolean): string {
  const folderName = lastSegment(normalizePath(path));
  const associations = expanded ? theme.folderNamesExpanded : theme.folderNames;
  return getIconUrl(associations[folderName] ?? (expanded ? theme.folderExpanded : theme.folder));
}

function getIconUrl(definitionName: string): string {
  const definition = theme.iconDefinitions[definitionName] ?? theme.iconDefinitions[theme.file];
  const fileName = definition?.iconPath.split('/').pop() ?? 'default_file.svg';
  return `${iconsUrl}/${fileName}`;
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
