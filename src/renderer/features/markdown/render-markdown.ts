import DOMPurify from 'isomorphic-dompurify';
import { Marked, type Token, type Tokens } from 'marked';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';
import markedKatex from 'marked-katex-extension';
import { getVsCodeFileIconUrl, getVsCodeLanguageIconUrl } from '../../lib/vscode-icons';
import { highlightCode } from './highlight';

export async function renderMarkdown(content: string): Promise<string> {
  const highlights = new Map<string, string>();
  const markdown = new Marked(
    markedAlert(),
    markedFootnote(),
    markedKatex({ throwOnError: false }),
    {
      async: true,
      gfm: true,
      renderer: {
        code({ text, lang }: Tokens.Code) {
          const descriptor = parseLanguageDescriptor(lang);
          if (descriptor.language === 'mermaid') {
            const encoded = encodeURIComponent(text);
            return `<div class="mermaid" data-mermaid-source="${encoded}">${escapeHtml(text)}</div>`;
          }
          const key = highlightKey(descriptor.language, text);
          const highlighted = highlights.get(key) ?? `<pre><code>${escapeHtml(text)}</code></pre>`;
          const label = descriptor.title ?? `.${descriptor.language}`;
          const iconUrl = descriptor.title
            ? getVsCodeFileIconUrl(descriptor.title)
            : getVsCodeLanguageIconUrl(descriptor.language);
          return [
            `<div class="markdown-code-block" data-language="${escapeAttribute(descriptor.language)}">`,
            '<div class="markdown-code-header">',
            '<span class="markdown-code-label">',
            iconUrl ? `<img class="markdown-code-icon" src="${escapeAttribute(iconUrl)}" alt="" aria-hidden="true">` : '',
            `<span>${escapeHtml(label)}</span>`,
            '</span>',
            `<button type="button" data-copy-code="${encodeURIComponent(text)}" aria-label="Copy code">Copy</button>`,
            '</div>',
            `<div class="markdown-code-content">${highlighted}</div>`,
            '</div>',
          ].join('');
        },
      },
      async walkTokens(token: Token) {
        if (token.type !== 'code') return;
        const codeToken = token as Tokens.Code;
        const descriptor = parseLanguageDescriptor(codeToken.lang);
        if (descriptor.language === 'mermaid') return;
        const html = await highlightCode(codeToken.text, descriptor.language);
        highlights.set(highlightKey(descriptor.language, codeToken.text), html);
      },
    },
  );

  const result = await markdown.parse(content);
  return DOMPurify.sanitize(result, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: ['aria-label', 'data-copy-code', 'data-language', 'data-mermaid-source'],
  });
}

function parseLanguageDescriptor(raw?: string): { language: string; title: string | null } {
  const descriptor = raw?.trim() || 'text';
  const title = descriptor.match(/\s+title="([^"]+)"/)?.[1] ?? null;
  const language = descriptor.split(/\s/, 1)[0]?.toLowerCase() || 'text';
  return { language, title };
}

function highlightKey(language: string, text: string): string {
  return `${language}\0${text}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
