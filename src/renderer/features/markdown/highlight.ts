import darkTheme from '@shikijs/themes/one-dark-pro';
import lightTheme from '@shikijs/themes/one-light';
import { createJavaScriptRawEngine } from 'shiki/engine/javascript';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { JUSTGIT_SYNTAX_THEMES } from '../viewer/syntaxThemes';
import { LazyLanguageLoader } from './LazyLanguageLoader';

type LanguageInput = Parameters<HighlighterCore['loadLanguage']>[0];

const languageLoaders = {
  html: () => import('@shikijs/langs-precompiled/html').then((module) => module.default),
  javascript: () => import('@shikijs/langs-precompiled/js').then((module) => module.default),
  typescript: () => import('@shikijs/langs-precompiled/ts').then((module) => module.default),
  tsx: () => import('@shikijs/langs-precompiled/tsx').then((module) => module.default),
  css: () => import('@shikijs/langs-precompiled/css').then((module) => module.default),
  json: () => import('@shikijs/langs-precompiled/json').then((module) => module.default),
  shellscript: () => import('@shikijs/langs-precompiled/bash').then((module) => module.default),
  markdown: () => import('@shikijs/langs-precompiled/markdown').then((module) => module.default),
  python: () => import('@shikijs/langs-precompiled/python').then((module) => module.default),
  yaml: () => import('@shikijs/langs-precompiled/yaml').then((module) => module.default),
  go: () => import('@shikijs/langs-precompiled/go').then((module) => module.default),
  docker: () => import('@shikijs/langs-precompiled/dockerfile').then((module) => module.default),
  sql: () => import('@shikijs/langs-precompiled/sql').then((module) => module.default),
  rust: () => import('@shikijs/langs-precompiled/rust').then((module) => module.default),
  java: () => import('@shikijs/langs-precompiled/java').then((module) => module.default),
  xml: () => import('@shikijs/langs-precompiled/xml').then((module) => module.default),
} satisfies Record<string, () => Promise<LanguageInput>>;

type SupportedLanguage = keyof typeof languageLoaders;

const languageAliases: Record<string, SupportedLanguage> = {
  html: 'html',
  javascript: 'javascript',
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  tsx: 'tsx',
  css: 'css',
  json: 'json',
  shellscript: 'shellscript',
  bash: 'shellscript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  markdown: 'markdown',
  md: 'markdown',
  python: 'python',
  py: 'python',
  yaml: 'yaml',
  yml: 'yaml',
  go: 'go',
  docker: 'docker',
  dockerfile: 'docker',
  sql: 'sql',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  xml: 'xml',
};

const lazyLanguages = new LazyLanguageLoader<SupportedLanguage, LanguageInput>(languageLoaders);
let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [lightTheme, darkTheme],
    langs: [],
    engine: createJavaScriptRawEngine(),
  }).then((instance) => {
    highlighterInstance = instance;
    return instance;
  });
  return highlighterPromise;
}

export async function highlightCode(code: string, language?: string): Promise<string> {
  const instance = await getHighlighter();
  const resolvedLanguage = resolveMarkdownLanguage(language);
  if (resolvedLanguage) {
    try {
      await lazyLanguages.ensure(
        resolvedLanguage,
        () => instance.getLoadedLanguages().includes(resolvedLanguage),
        async (grammar) => instance.loadLanguage(grammar),
      );
    } catch {
      return codeToHtml(instance, code, 'text');
    }
  }
  return codeToHtml(instance, code, resolvedLanguage ?? 'text');
}

export function resolveMarkdownLanguage(language?: string): SupportedLanguage | null {
  const normalized = language?.trim().toLowerCase();
  if (!normalized || normalized === 'text' || normalized === 'txt' || normalized === 'plaintext') return null;
  return languageAliases[normalized] ?? null;
}

export function getLoadedMarkdownLanguages(): string[] {
  return highlighterInstance?.getLoadedLanguages() ?? [];
}

function codeToHtml(instance: HighlighterCore, code: string, language: string): string {
  return instance.codeToHtml(code, {
    lang: language,
    themes: JUSTGIT_SYNTAX_THEMES,
    defaultColor: false,
  });
}
