import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { unified } from '@astrojs/markdown-remark';
import { guideMarkdown, guideTables } from './scripts/guide-markdown.mjs';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { validateBuild } from './scripts/validate-build.mjs';

let buildSite;
let buildIndexable;
const seoValidation = {
  name: 'opentig-seo-validation',
  hooks: {
    'astro:config:done': ({ config }) => { buildSite = config.site; },
    'astro:build:done': ({ dir, logger }) => {
      if (!buildIndexable && dir.href === new URL('./dist/', import.meta.url).href) {
        throw new Error('Noindex previews must use a separate --outDir, such as ../.ai/website-preview. website/dist is reserved for production deployment.');
      }
      const count = validateBuild({ directory: fileURLToPath(dir), site: buildSite, indexable: buildIndexable });
      logger.info(`SEO checks passed for ${count} HTML pages (${buildIndexable ? 'production' : 'noindex preview'}).`);
    },
  },
};

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  site: process.env.WEBSITE_URL || 'https://opentig.com',
  compressHTML: true,
  devToolbar: { enabled: false },
  integrations: [react(), seoValidation],
  markdown: { processor: unified({ smartypants: false, remarkPlugins: [guideMarkdown], rehypePlugins: [guideTables] }) },
  vite: {
    plugins: [tailwindcss(), {
      name: 'opentig-indexing-policy',
      configResolved(config) {
        const value = loadEnv(config.mode, config.envDir, 'WEBSITE_').WEBSITE_NOINDEX;
        if (value !== undefined && value !== 'true' && value !== 'false') {
          throw new Error('WEBSITE_NOINDEX must be true, false, or unset.');
        }
        buildIndexable = value !== 'true';
      },
    }],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
});
