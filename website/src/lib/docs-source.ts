import { getCollection } from 'astro:content';
import { loader, type StaticSource } from 'fumadocs-core/source';
import { structure } from 'fumadocs-core/mdx-plugins';
import { guideMarkdown } from '../../scripts/guide-markdown.mjs';
import { publishedGuides, documentationSections, documentationUrls } from '@/docs';

const overview = (await getCollection('docsOverview'))[0];
if (!overview) throw new Error('The documentation overview is missing.');
const pages = [
  { entry: overview, title: overview.data.title, description: overview.data.description, source: 'website/src/content/docs/index.md', slug: 'index' },
  ...(await getCollection('guides')).map(entry => {
    const guide = publishedGuides[entry.id as keyof typeof publishedGuides];
    if (!guide) throw new Error(`Unlisted documentation guide: ${entry.id}`);
    return { entry, ...guide, slug: entry.id };
  }),
];

const content: StaticSource<{ pageData: typeof pages[number] & { structuredData: ReturnType<typeof structure> }; metaData: { title: string; pages: string[] } }> = {
    files: [
      ...pages.map(page => ({
        type: 'page' as const,
        path: `${page.slug}.md`,
        data: { ...page, structuredData: structure(page.entry.body ?? '', [[guideMarkdown, { source: page.source }]]) },
      })),
      { type: 'meta' as const, path: 'meta.json', data: { title: 'Documentation', pages: documentationSections.flatMap(section => [`---${section.title}---`, ...section.pages]) } },
    ],
};

export const source = loader(content, {
  baseUrl: '/docs',
  plugins: [documentationUrls],
});
