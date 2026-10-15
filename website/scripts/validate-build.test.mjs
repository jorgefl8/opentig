import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateBuild } from './validate-build.mjs';

function fixture(t, { indexable = true, site = 'https://opentig.com/' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'opentig-seo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (name, value) => writeFileSync(join(directory, name), value);
  const change = (name, before, after) => write(name, readFileSync(join(directory, name), 'utf8').replace(before, after));
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${site}#website`, name: 'OpenTig', url: site, inLanguage: 'en', about: { '@id': `${site}#application` } },
      { '@type': 'SoftwareApplication', '@id': `${site}#application`, name: 'OpenTig', url: site, description: 'Review & commit.',
        applicationCategory: 'DeveloperApplication', applicationSubCategory: 'Git client', operatingSystem: ['Windows'],
        softwareRequirements: 'Git on the host.', isAccessibleForFree: true, license: 'https://github.com/jorgefl8/opentig/blob/main/LICENSE',
        sameAs: 'https://github.com/jorgefl8/opentig', installUrl: 'https://github.com/jorgefl8/opentig/blob/main/docs/getting-started.md',
        offers: { '@type': 'Offer', price: 0, url: 'https://github.com/jorgefl8/opentig/releases/latest' } },
    ],
  };
  const html = (error = false) => `<!doctype html><html lang="en"><head><title>OpenTig</title>
    <meta name="description" content="Review &amp; commit.">
    ${error || !indexable ? '<meta name="robots" content="noindex">' : ''}
    ${error ? '' : `<link rel="canonical" href="${site}"><meta property="og:url" content="${site}">`}
    <meta property="og:title" content="OpenTig"><meta name="twitter:title" content="OpenTig">
    <meta property="og:description" content="Review &amp; commit."><meta name="twitter:description" content="Review &amp; commit.">
    <meta property="og:type" content="website"><meta property="og:site_name" content="OpenTig">
    <meta name="twitter:card" content="summary_large_image">
    <meta property="og:image" content="${site}card.png"><meta name="twitter:image" content="${site}card.png">
    <meta property="og:image:alt" content="OpenTig screenshot"><meta name="twitter:image:alt" content="OpenTig screenshot">
    <meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
    <link rel="stylesheet" href="/assets/main.css">
    ${indexable && !error ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}
    </head><body><h1>OpenTig</h1><div id="features&amp;more">Features</div><a href="/#features%26more">Features</a></body></html>`;
  write('index.html', html()); write('404.html', html(true));
  write('robots.txt', `User-agent: *\nAllow: /\n${indexable ? `Sitemap: ${site}sitemap.xml\n` : ''}`);
  write('sitemap.xml', `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexable ? `<url><loc>${site}</loc></url>` : ''}</urlset>`);
  mkdirSync(join(directory, 'assets'));
  write('assets/main.css', '@font-face{src:url("./font.woff2")}'); write('assets/font.woff2', 'fixture');
  copyFileSync(new URL('../public/opentig-social.png', import.meta.url), join(directory, 'card.png'));
  return { write, change, directory, validate: () => validateBuild({ directory, site, indexable }) };
}

test('accepts production output, decoded entities and real fragment targets', (t) => {
  assert.equal(fixture(t).validate(), 2);
});
test('accepts noindex previews and an explicitly configured public origin', (t) => {
  assert.equal(fixture(t, { indexable: false }).validate(), 2);
  assert.equal(fixture(t, { site: 'https://demo.example.com/' }).validate(), 2);
});

const regressions = [
  ['duplicate title', 'index.html', '<title>OpenTig</title>', '<title>OpenTig</title><title>Duplicate</title>', /duplicate title/],
  ['missing description', 'index.html', '<meta name="description" content="Review &amp; commit.">', '', /description meta tag/],
  ['social copy mismatch', 'index.html', 'name="twitter:title" content="OpenTig"', 'name="twitter:title" content="Wrong"', /twitter title differs/],
  ['accidental production noindex', 'index.html', '</head>', '<meta name="robots" content="noindex"></head>', /noindex policy/],
  ['wrong canonical', 'index.html', 'rel="canonical" href="https://opentig.com/"', 'rel="canonical" href="https://opentig.com/wrong"', /incorrect canonical/],
  ['missing asset', 'index.html', '/assets/main.css', '/assets/missing.css', /missing local target/],
  ['missing anchor', 'index.html', '/#features%26more', '/#missing', /missing fragment/],
  ['nested missing page', 'index.html', '/#features%26more', '/docs/missing/', /missing local target/],
  ['localhost link', 'index.html', '/#features%26more', 'http://localhost:4321/', /local or private URL/],
  ['IPv6 loopback link', 'index.html', '/#features%26more', 'http://[::1]/', /local or private URL/],
  ['missing CSS font', 'assets/main.css', './font.woff2', './missing.woff2', /missing local target/],
  ['incorrect image dimensions', 'index.html', 'og:image:width" content="1200', 'og:image:width" content="999', /image dimensions/],
  ['malformed JSON-LD', 'index.html', '"@context":"https://schema.org"', '"@context":', /JSON/],
  ['broken schema identity', 'index.html', '"about":{"@id":"https://opentig.com/#application"}', '"about":{"@id":"https://opentig.com/#missing"}', /schema entity links/],
  ['local schema link', 'index.html', '"sameAs":"https://github.com/jorgefl8/opentig"', '"sameAs":"http://127.0.0.1/"', /local or private URL/],
  ['malformed sitemap', 'sitemap.xml', '</urlset>', '</wrong>', /invalid sitemap XML/],
  ['sitemap includes 404', 'sitemap.xml', '</urlset>', '<url><loc>https://opentig.com/404</loc></url></urlset>', /sitemap does not match/],
  ['missing sitemap page', 'sitemap.xml', '<url><loc>https://opentig.com/</loc></url>', '', /sitemap does not match/],
  ['empty sitemap entry', 'sitemap.xml', '</urlset>', '<url/></urlset>', /one location/],
  ['duplicate sitemap URL', 'sitemap.xml', '</urlset>', '<url><loc>https://opentig.com/</loc></url></urlset>', /duplicate sitemap URLs/],
  ['blocked crawling', 'robots.txt', 'Allow: /', 'Disallow: /', /robots.txt policy/],
  ['wrong sitemap announcement', 'robots.txt', 'https://opentig.com/sitemap.xml', 'http://localhost/sitemap.xml', /robots.txt policy/],
  ['indexable error page', '404.html', '<meta name="robots" content="noindex">', '', /noindex policy/],
];
for (const [name, file, before, after, error] of regressions) {
  test(`rejects ${name}`, (t) => {
    const output = fixture(t);
    output.change(file, before, after);
    assert.throws(output.validate, error);
  });
}
test('rejects a preview that becomes indexable or announces a sitemap', (t) => {
  const output = fixture(t, { indexable: false });
  output.change('index.html', '<meta name="robots" content="noindex">', '');
  assert.throws(output.validate, /noindex policy/);
  const second = fixture(t, { indexable: false });
  second.write('robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://opentig.com/sitemap.xml\n');
  assert.throws(second.validate, /robots.txt policy/);
});
