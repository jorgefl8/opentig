// Turns a vscode-icons theme manifest (the dark theme's `vscode-icons-theme.json`) into the
// compact map the app reads: `src/renderer/assets/vscode-icons-map.json`.
//
//   node scripts/compact-vscode-icons.mjs path/to/vscode-icons-theme.json
//
// Each association names its SVG directly instead of an icon definition, the light theme's
// associations (never read) are left out, and every icon lists its keys once, joined by `|`.
// Expanded folders are the folder's icon with `_opened`, which the app adds itself.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [source] = process.argv.slice(2);
if (!source) throw new Error('Usage: node scripts/compact-vscode-icons.mjs <vscode-icons-theme.json>');
const theme = JSON.parse(readFileSync(source, 'utf8'));
const icon = (definition) => {
  const resolved = theme.iconDefinitions[definition] ?? theme.iconDefinitions[theme.file];
  return (resolved?.iconPath.split('/').pop() ?? 'default_file.svg').replace(/\.svg$/, '');
};
const group = (associations) => {
  const byIcon = {};
  for (const [key, definition] of Object.entries(associations)) {
    if (key.includes('|')) throw new Error(`A key contains the separator: ${key}`);
    (byIcon[icon(definition)] ??= []).push(key);
  }
  return Object.fromEntries(Object.entries(byIcon).map(([name, keys]) => [name, keys.join('|')]));
};
for (const [folder, definition] of Object.entries(theme.folderNamesExpanded)) {
  if (icon(definition) !== `${icon(theme.folderNames[folder])}_opened`) throw new Error(`The expanded icon of ${folder} is not its icon with _opened.`);
}
const map = {
  file: icon(theme.file),
  folder: icon(theme.folder),
  folderExpanded: icon(theme.folderExpanded),
  fileExtensions: group(theme.fileExtensions),
  fileNames: group(theme.fileNames),
  folderNames: group(theme.folderNames),
  languageIds: group(theme.languageIds),
};
const target = path.resolve(import.meta.dirname, '../src/renderer/assets/vscode-icons-map.json');
writeFileSync(target, `${JSON.stringify(map)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), target)}: ${JSON.stringify(map).length} bytes.`);
