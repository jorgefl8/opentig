const EXTENSION_LANGUAGES: Record<string, string> = {
  bat: 'batch',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  less: 'less',
  lua: 'lua',
  m: 'objectivec',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  pl: 'perl',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'markup',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
  vue: 'markup',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

const FILE_LANGUAGES: Record<string, string> = {
  dockerfile: 'docker',
  gemfile: 'ruby',
  makefile: 'makefile',
};

export function sourceLanguage(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (FILE_LANGUAGES[name]) return FILE_LANGUAGES[name];
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return EXTENSION_LANGUAGES[extension] ?? 'text';
}
