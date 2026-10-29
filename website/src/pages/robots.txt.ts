import type { APIRoute } from 'astro';
import { indexable } from '@/indexing';
import { contentSignals } from '../../scripts/agent-access.mjs';

export const GET: APIRoute = ({ site }) => {
  // Crawlers must be able to read the noindex tags on preview pages.
  const sitemap = indexable && site ? `\nSitemap: ${new URL('/sitemap.xml', site)}\n` : '';
  return new Response(`User-agent: *\nContent-Signal: ${contentSignals}\nAllow: /\n${sitemap}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
