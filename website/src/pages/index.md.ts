import type { APIRoute } from 'astro';
import { overviewMarkdown } from '@/lib/agent-markdown';

// Markdown twin of the landing page for agents; see website/worker/index.mjs.
export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('The homepage Markdown needs the public site origin.');
  return new Response(overviewMarkdown(site), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
