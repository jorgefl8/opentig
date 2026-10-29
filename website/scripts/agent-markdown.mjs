import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { guideMarkdown } from './guide-markdown.mjs';

// Same link rewriting as the rendered page, with the page title restored as the H1.
export async function pageMarkdown({ title, description, body, source }) {
  const content = await unified()
    .use(remarkParse)
    .use(remarkGfm, { tablePipeAlign: false })
    .use(guideMarkdown, { source })
    .use(remarkStringify, { bullet: '-', rule: '-', fences: true })
    .process(body);
  return `# ${title}\n\n> ${description}\n\n${String(content).trim()}\n`;
}

// llms.txt layout (https://llmstxt.org/): title, summary, details, then linked sections.
export function siteMarkdown({ site, description, details, sections }) {
  const link = path => new URL(path, site).href;
  return [
    '# OpenTig',
    `> ${description}`,
    details.join('\n'),
    ...sections.map(({ title, pages }) => [
      `## ${title}`,
      pages.map(page => `- [${page.title}](${link(page.markdown)}): ${page.description}`).join('\n'),
    ].join('\n\n')),
  ].join('\n\n') + '\n';
}
