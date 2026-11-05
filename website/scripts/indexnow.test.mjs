import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { indexNowEndpoint, indexNowKey, indexNowSubmission, submitSitemap } from './indexnow.mjs';

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://opentig.com/</loc></url>
<url><loc>https://opentig.com/docs/?a=1&amp;b=2</loc></url>
</urlset>`;

test('publishes the key file that proves ownership of the IndexNow key', () => {
  assert.match(indexNowKey, /^[a-f0-9]{32}$/);
  assert.equal(readFileSync(new URL(`../public/${indexNowKey}.txt`, import.meta.url), 'utf8'), indexNowKey);
});

test('submits every sitemap page with the key location on the same host', () => {
  assert.deepEqual(indexNowSubmission(sitemap), {
    host: 'opentig.com',
    key: indexNowKey,
    keyLocation: `https://opentig.com/${indexNowKey}.txt`,
    urlList: ['https://opentig.com/', 'https://opentig.com/docs/?a=1&b=2'],
  });
});

test('refuses empty, mixed-origin and plain HTTP sitemaps', () => {
  assert.throws(() => indexNowSubmission('<urlset></urlset>'), /no pages/);
  assert.throws(() => indexNowSubmission('<loc>https://opentig.com/</loc><loc>https://example.com/</loc>'), /one origin/);
  assert.throws(() => indexNowSubmission('<loc>http://opentig.com/</loc>'), /HTTPS/);
});

test('posts the submission and reports refusals', async () => {
  const calls = [];
  const fetchImpl = status => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status }); };
  assert.equal(await submitSitemap(sitemap, fetchImpl(202)), 2);
  assert.equal(calls[0].url, indexNowEndpoint);
  assert.equal(calls[0].body.urlList.length, 2);
  await assert.rejects(submitSitemap(sitemap, fetchImpl(403)), /HTTP 403/);
});
