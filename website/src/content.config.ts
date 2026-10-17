import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { publishedGuides } from './docs';
import { documentationRoutes } from '../docs.config.mjs';

const guideLoader = glob({
  base: '..',
  pattern: Object.values(publishedGuides).map(guide => guide.source),
  generateId: ({ entry }) => {
    const match = Object.entries(publishedGuides).find(([, guide]) => guide.source === entry.replaceAll('\\', '/'));
    if (!match) throw new Error(`Unlisted documentation source: ${entry}`);
    return match[0];
  },
});

export const collections = {
  guides: defineCollection({
    loader: {
      ...guideLoader,
      load(context) {
        return guideLoader.load({
          ...context,
          // Rendered links depend on publication routes as well as Markdown.
          generateDigest: content => context.generateDigest({ content, routes: [...documentationRoutes] }),
        });
      },
    },
    schema: z.object({}),
  }),
  docsOverview: defineCollection({
    loader: glob({ base: './src/content/docs', pattern: 'index.md' }),
    schema: z.object({ title: z.string(), description: z.string() }),
  }),
};
