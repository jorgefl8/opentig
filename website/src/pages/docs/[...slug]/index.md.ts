import type { APIRoute, GetStaticPaths } from 'astro';
import { documentationMarkdown, type DocumentationPage } from '@/lib/agent-markdown';
import { source } from '@/lib/docs-source';

// Markdown twin of each documentation page for agents; see website/worker/index.mjs.
export const getStaticPaths = (() => source.getPages().map(page => ({
  params: { slug: page.slugs.join('/') || undefined },
  props: { page },
}))) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: DocumentationPage }> = async ({ props }) =>
  new Response(await documentationMarkdown(props.page), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
