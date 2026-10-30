import { markdownPath } from '../scripts/agent-access.mjs';

// Highest quality the Accept header gives each media type; wildcards don't count.
function quality(accept, type) {
  let best = 0;
  for (const range of accept.split(',')) {
    const [name, ...parameters] = range.split(';').map(part => part.trim().toLowerCase());
    if (name !== type) continue;
    const q = parameters.find(parameter => parameter.startsWith('q='));
    const value = q === undefined ? 1 : Number(q.slice(2));
    if (Number.isFinite(value)) best = Math.max(best, Math.min(value, 1));
  }
  return best;
}

// Browsers never list text/markdown, so only clients asking for it explicitly get Markdown.
export function prefersMarkdown(accept) {
  if (!accept) return false;
  const markdown = quality(accept, 'text/markdown');
  return markdown > 0 && markdown >= quality(accept, 'text/html');
}

function withHeaders(response, headers) {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
  return result;
}

// Runs only for the HTML routes listed in wrangler.jsonc `run_worker_first`; everything else
// is served by Workers Static Assets directly.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/') || !['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
    if (prefersMarkdown(request.headers.get('Accept'))) {
      const markdown = await env.ASSETS.fetch(new Request(new URL(markdownPath(url.pathname), url), { method: request.method }));
      if (markdown.ok) {
        return withHeaders(markdown, { 'Content-Type': 'text/markdown; charset=utf-8', Vary: 'Accept' });
      }
    }
    const response = await env.ASSETS.fetch(request);
    return response.ok ? withHeaders(response, { Vary: 'Accept' }) : response;
  },
};
