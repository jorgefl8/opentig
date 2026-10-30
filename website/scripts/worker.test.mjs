import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { prefersMarkdown } from '../worker/index.mjs';

// Stand-in for the Workers Static Assets binding with a few generated files.
const files = {
  '/': ['<h1>OpenTig</h1>', 'text/html'],
  '/index.md': ['# OpenTig\n', 'text/markdown'],
  '/docs/github/': ['<h1>GitHub</h1>', 'text/html'],
  '/docs/github/index.md': ['# GitHub\n', 'text/markdown'],
  '/demo/': ['<h1>Demo</h1>', 'text/html'],
};
const env = {
  ASSETS: {
    fetch: async request => {
      const file = files[new URL(request.url).pathname];
      if (!file) return new Response('<h1>Not found</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } });
      return new Response(request.method === 'HEAD' ? null : file[0], { headers: { 'Content-Type': file[1] } });
    },
  },
};
const get = (path, accept, method = 'GET') =>
  worker.fetch(new Request(`https://opentig.com${path}`, { method, headers: accept ? { Accept: accept } : {} }), env);

test('only an explicit, preferred text/markdown selects Markdown', () => {
  assert.equal(prefersMarkdown('text/markdown'), true);
  assert.equal(prefersMarkdown('text/markdown, text/html;q=0.9'), true);
  assert.equal(prefersMarkdown('Text/Markdown; charset=utf-8'), true);
  assert.equal(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'), false);
  assert.equal(prefersMarkdown('text/html, text/markdown;q=0.5'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0'), false);
  assert.equal(prefersMarkdown('*/*'), false);
  assert.equal(prefersMarkdown(null), false);
});

test('serves the Markdown twin of a page when agents ask for it', async () => {
  for (const [path, body] of [['/', '# OpenTig\n'], ['/docs/github/', '# GitHub\n']]) {
    const response = await get(path, 'text/markdown');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
    assert.equal(response.headers.get('Vary'), 'Accept');
    assert.equal(await response.text(), body);
  }
  const head = await get('/docs/github/', 'text/markdown', 'HEAD');
  assert.equal(head.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.equal(await head.text(), '');
});

test('browsers and pages without a Markdown twin keep the HTML response', async () => {
  const browser = await get('/docs/github/', 'text/html,*/*;q=0.8');
  assert.equal(browser.headers.get('Content-Type'), 'text/html');
  assert.equal(browser.headers.get('Vary'), 'Accept');
  assert.equal(await browser.text(), '<h1>GitHub</h1>');
  const demo = await get('/demo/', 'text/markdown');
  assert.equal(await demo.text(), '<h1>Demo</h1>');
  const missing = await get('/docs/missing/', 'text/markdown');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Vary'), null);
  const file = await get('/docs/github/index.md');
  assert.equal(await file.text(), '# GitHub\n');
});
