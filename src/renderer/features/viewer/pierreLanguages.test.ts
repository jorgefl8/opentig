import { describe, expect, it } from 'vitest';
import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import lightTheme from '@shikijs/themes/one-light';
import darkTheme from '@shikijs/themes/one-dark-pro';
import { bundledLanguages } from '@/lib/pierre-bundled-languages';
import { resolvePierreLanguage } from './pierreLanguages';
import { buildDiffFileEntries } from './patch-utils';

const cases = [
  ['assets/logo.svg', 'xml'], ['assets/logo.SvG', 'xml'], ['src/main.TS', 'typescript'],
  ['src/main.C', 'c'], ['src/main.h', 'objective-cpp'], ['src/main.hpp', 'cpp'],
  ['src/app.csproj', 'xml'], ['src/view.xaml', 'xml'], ['build/app.props', 'xml'],
  ['src/view.xhtml', 'html'], ['src/transform.xslt', 'xsl'],
  ['docker/Dockerfile', 'dockerfile'], ['docker/Dockerfile.dev', 'dockerfile'],
  ['docker/Containerfile', 'dockerfile'], ['src/Makefile', 'makefile'],
  ['src/CMakeLists.txt', 'cmake'], ['build/thing.cmake', 'cmake'],
  ['server/Gemfile', 'ruby'], ['server/Rakefile', 'ruby'], ['ci/Jenkinsfile', 'groovy'],
  ['src/main.astro', 'astro'], ['db/schema.prisma', 'prisma'], ['src/main.groovy', 'groovy'],
  ['scripts/run.bat', 'cmd'], ['scripts/run.cmd', 'cmd'], ['nginx/server.conf', 'nginx'],
  ['app/.env', 'dotenv'], ['app/.env.local', 'dotenv'], ['app/.env.production', 'dotenv'],
  ['app/.gitignore', 'gitignore'], ['app/.dockerignore', 'gitignore'], ['.git/info/exclude', 'gitignore'],
  ['app/.gitattributes', 'gitattributes'], ['app/.editorconfig', 'ini'], ['app/.npmrc', 'ini'],
  ['app/tsconfig.json', 'jsonc'], ['app/tsconfig.build.json', 'jsonc'], ['app/jsconfig.json', 'jsonc'],
  ['.vscode/settings.json', 'jsonc'], ['app/.eslintrc', 'jsonc'],
  ['assets/installer.nsh', 'nsis'], ['setup/install.nsi', 'nsis'],
  ['package.json', 'json'], ['unknown.xyz', 'text'],
] as const;

describe('Pierre language detection', () => {
  it.each(cases)('resolves %s to %s for files and patches', (path, lang) => {
    expect(resolvePierreLanguage(path)).toBe(lang);
    expect(resolvePierreLanguage(path.replaceAll('/', '\\'))).toBe(lang);
    const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
    expect(buildDiffFileEntries(patch)[0]?.fileDiff.lang).toBe(lang);
  });

  it('preserves filename detection before normalizing extension case', () => {
    expect(resolvePierreLanguage('src/component.tsx')).toBe('tsx');
    expect(resolvePierreLanguage('src/component.TSX')).toBe('tsx');
  });
});

const samples = {
  'xml': '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
  'dotenv': '# settings\nPORT=3000\nNAME="demo"',
  'cmd': 'REM comment\n@echo "hello"\nset PORT=3000',
  'astro': '---\nconst name = "demo";\n---\n<h1>{name}</h1>',
  'prisma': 'model User {\n  id Int @id @default(autoincrement())\n}',
  'cmake': '# Build\ncmake_minimum_required(VERSION 3.20)\nproject("demo")',
  'nginx': '# Server\nserver { listen 80; server_name localhost; }',
  'groovy': '// Script\ndef name = "demo"\nprintln(name)',
  'objective-cpp': '// Header\n#pragma once\nint answer = 42;',
  'xsl': '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>',
  'gitignore': '# generated\n*.log\n!keep.log\n',
  'gitattributes': '# Normalize\n*.ts text eol=lf\n',
  'nsis': '; Installer\n!define APP "Demo"\nSection\n  SetOutPath "$INSTDIR"\nSectionEnd',
  'jsonc': '// Options\n{ "compilerOptions": { "strict": true } }',
  'ini': '# Settings\n[*.ts]\nindent_size = 2',
} as const;

describe('repository syntax grammars', () => {
  it('loads real grammars and colors representative syntax in light and dark themes', async () => {
    const highlighter = await createHighlighterCore({
      langs: await Promise.all(Object.keys(samples).map(name => bundledLanguages[name as keyof typeof samples]())),
      themes: [lightTheme, darkTheme],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
    try {
      for (const [lang, sample] of Object.entries(samples)) {
        for (const theme of ['one-light', 'one-dark-pro']) {
          const { tokens } = highlighter.codeToTokens(sample, { lang, theme });
          expect(new Set(tokens.flat().map(token => token.color)).size, `${lang} in ${theme}`).toBeGreaterThan(1);
        }
      }
    } finally {
      highlighter.dispose();
    }
  });
});
