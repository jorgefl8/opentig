import { documentationSections } from '@/docs';
import { source } from '@/lib/docs-source';
import { cliInstallCommand, npmUrl, repositoryUrl, siteDescription } from '@/site';
import { markdownPath } from '../../scripts/agent-access.mjs';
import { pageMarkdown, siteMarkdown } from '../../scripts/agent-markdown.mjs';

export type DocumentationPage = ReturnType<typeof source.getPages>[number];

export const documentationMarkdown = (page: DocumentationPage) => pageMarkdown({
  title: page.data.title,
  description: page.data.description,
  body: page.data.entry.body ?? '',
  source: page.data.source,
});

// Shared by /llms.txt and the homepage's Markdown twin; facts mirror the landing page.
export function overviewMarkdown(site: URL) {
  const pages = new Map(source.getPages().map(page => [page.data.slug, page]));
  return siteMarkdown({
    site,
    description: siteDescription,
    details: [
      'OpenTig is a free, open-source (MIT) Git client. Repositories and Git commands stay on the machine running OpenTig.',
      '',
      `- Windows desktop: download the installer from ${repositoryUrl}/releases/latest (Windows 10 or later, x64, with Git installed).`,
      `- CLI with browser access on Linux, macOS, or Windows (Node.js 24+ and Git): \`${cliInstallCommand}\``,
      `- Source code: ${repositoryUrl}`,
      `- npm package: ${npmUrl}`,
    ],
    sections: documentationSections.map(section => ({
      title: section.title,
      pages: section.pages.map(slug => {
        const page = pages.get(slug);
        if (!page) throw new Error(`Unlisted documentation page: ${slug}`);
        return { title: page.data.title, description: page.data.description, markdown: markdownPath(page.url) };
      }),
    })),
  });
}
