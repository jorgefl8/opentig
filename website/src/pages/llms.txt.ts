import type { APIRoute } from 'astro';
import { overviewMarkdown } from '@/lib/agent-markdown';

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('llms.txt needs the public site origin.');
  return new Response(overviewMarkdown(site), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
