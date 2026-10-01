import { getFiletypeFromFileName, setCustomExtension, type SupportedLanguages } from '@pierre/diffs';

const extensions: Record<string, SupportedLanguages> = {
  svg: 'xml', xhtml: 'html', csproj: 'xml', fsproj: 'xml', vbproj: 'xml',
  xaml: 'xml', props: 'xml', targets: 'xml', resx: 'xml',
  nsh: 'nsis', nsi: 'nsis',
};
for (const [extension, lang] of Object.entries(extensions)) setCustomExtension(extension, lang);
setCustomExtension('SVG', 'xml');

const filenames: Record<string, SupportedLanguages> = {
  '.gitignore': 'gitignore', '.dockerignore': 'gitignore',
  '.gitattributes': 'gitattributes', '.editorconfig': 'ini', '.npmrc': 'ini',
  '.eslintrc': 'jsonc', '.babelrc': 'jsonc',
  dockerfile: 'dockerfile', containerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile',
  jenkinsfile: 'groovy', gemfile: 'ruby', rakefile: 'ruby', 'cmakelists.txt': 'cmake',
};

/** Explicit language travels with Pierre's file metadata into workers and edit mode. */
export function resolvePierreLanguage(path: string): SupportedLanguages {
  const normalized = path.replaceAll('\\', '/');
  const name = normalized.split('/').pop() ?? normalized;
  const lower = name.toLowerCase();
  if (/^\.env(?:\.|$)/.test(lower)) return 'dotenv';
  if (/^(?:dockerfile|containerfile)\./.test(lower)) return 'dockerfile';
  if (/^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/.test(lower)
    || /(?:^|\/)\.vscode\/[^/]+\.json$/i.test(normalized)) return 'jsonc';
  if (Object.hasOwn(filenames, lower)) return filenames[lower]!;
  if (normalized.endsWith('/.git/info/exclude') || normalized === '.git/info/exclude') return 'gitignore';
  const detected = getFiletypeFromFileName(name);
  return detected === 'text' ? getFiletypeFromFileName(lower) : detected;
}
