import type { APIRoute } from 'astro';
import { documentationPaths } from '@/docs';
import { indexable } from '@/indexing';

// Add canonical content routes here when new public pages are published.
const publicPaths = ['/', ...documentationPaths];

export const GET: APIRoute = ({ site }) => {
  const urls = indexable && site
    ? publicPaths.map((path) => `<url><loc>${new URL(path, site).href}</loc></url>`).join('\n')
    : '';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
