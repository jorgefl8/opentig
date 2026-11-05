// IndexNow (https://www.indexnow.org/) tells Bing and the other participating search engines
// which pages changed, so a deployment reaches their indexes without waiting for a crawl.
// The key is public by design: public/<key>.txt holds it to prove this site owns it.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const indexNowKey = '13f7782fcc6413be351617f1630608ed';
export const indexNowEndpoint = 'https://api.indexnow.org/indexnow';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Build the IndexNow request body from a built sitemap.xml. */
export function indexNowSubmission(sitemapXml) {
  const urls = [...sitemapXml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
    .map(match => match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name]));
  if (urls.length === 0) throw new Error('The sitemap lists no pages to submit.');
  const origins = new Set(urls.map(url => new URL(url).origin));
  if (origins.size !== 1) throw new Error('Sitemap pages must share one origin.');
  const [origin] = origins;
  if (!origin.startsWith('https://')) throw new Error('Sitemap pages must use HTTPS.');
  return { host: new URL(origin).host, key: indexNowKey, keyLocation: `${origin}/${indexNowKey}.txt`, urlList: urls };
}

/** Submit every page of the sitemap; IndexNow answers 200 or 202 when it accepts them. */
export async function submitSitemap(sitemapXml, fetchImpl = fetch) {
  const body = indexNowSubmission(sitemapXml);
  const response = await fetchImpl(indexNowEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow refused ${body.urlList.length} pages for ${body.host}: HTTP ${response.status}`);
  }
  return body.urlList.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const sitemap = process.argv[2];
  if (!sitemap) throw new Error('Usage: node indexnow.mjs <path to sitemap.xml>');
  const count = await submitSitemap(readFileSync(sitemap, 'utf8'));
  console.log(`Submitted ${count} pages to IndexNow.`);
}
