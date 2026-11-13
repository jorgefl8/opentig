import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageSize, validateBuild } from './validate-build.mjs';

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
        sameAs: ['https://github.com/jorgefl8/opentig', 'https://www.npmjs.com/package/@opentig/cli'], installUrl: 'https://github.com/jorgefl8/opentig/blob/main/docs/getting-started.md',
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', url: 'https://github.com/jorgefl8/opentig/releases/latest' },
        author: { '@id': `${site}#author` } },
      { '@type': 'Person', '@id': `${site}#author`, name: 'jorgefl8', url: 'https://github.com/jorgefl8' },
    ],
  };
  const html = (error = false) => `<!doctype html><html lang="en"><head><title>OpenTig</title>
    <meta name="description" content="Review &amp; commit.">
    ${error || !indexable ? '<meta name="robots" content="noindex">' : ''}
    ${error ? '' : `<link rel="canonical" href="${site}"><meta property="og:url" content="${site}">`}
    ${error ? '' : '<link rel="alternate" type="text/markdown" href="/index.md">'}
    <meta property="og:title" content="OpenTig"><meta name="twitter:title" content="OpenTig">
    <meta property="og:description" content="Review &amp; commit."><meta name="twitter:description" content="Review &amp; commit.">
    <meta property="og:type" content="website"><meta property="og:site_name" content="OpenTig">
    <meta name="twitter:card" content="summary_large_image">
    <meta property="og:image" content="${site}card.jpg"><meta name="twitter:image" content="${site}card.jpg">
    <meta property="og:image:alt" content="OpenTig screenshot"><meta name="twitter:image:alt" content="OpenTig screenshot">
    <meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="2400"><meta property="og:image:height" content="1260">
    <link rel="stylesheet" href="/assets/main.css">
    ${indexable && !error ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}
    </head><body><h1>OpenTig</h1><div id="features&amp;more">Features</div><a href="/#features%26more">Features</a></body></html>`;
  write('index.html', html()); write('404.html', html(true));
  write('robots.txt', `User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\nAllow: /\n${indexable ? `Sitemap: ${site}sitemap.xml\n` : ''}`);
  write('index.md', '# OpenTig\n'); write('llms.txt', '# OpenTig\n\n> Review & commit.\n');
  write('_headers', '/\n  Link: </index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"\n'
    + '/docs/:page/\n  Link: </docs/:page/index.md>; rel="alternate"; type="text/markdown"\n/404\n  X-Robots-Tag: noindex\n');
  write('sitemap.xml', `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexable ? `<url><loc>${site}</loc></url>` : ''}</urlset>`);
  mkdirSync(join(directory, 'assets'));
  write('assets/main.css', '@font-face{src:url("./font.woff2")}'); write('assets/font.woff2', 'fixture');
  copyFileSync(new URL('../public/opentig-social.jpg', import.meta.url), join(directory, 'card.jpg'));
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
  ['incorrect image dimensions', 'index.html', 'og:image:width" content="2400', 'og:image:width" content="999', /image dimensions/],
  ['incorrect image type', 'index.html', 'og:image:type" content="image/jpeg', 'og:image:type" content="image/png', /image dimensions or type/],
  ['malformed JSON-LD', 'index.html', '"@context":"https://schema.org"', '"@context":', /JSON/],
  ['broken schema identity', 'index.html', '"about":{"@id":"https://opentig.com/#application"}', '"about":{"@id":"https://opentig.com/#missing"}', /schema entity links/],
  ['local schema link', 'index.html', '"sameAs":["https://github.com/jorgefl8/opentig"', '"sameAs":["http://127.0.0.1/"', /local or private URL/],
  ['missing price currency', 'index.html', '"priceCurrency":"USD",', '', /free availability/],
  ['malformed sitemap', 'sitemap.xml', '</urlset>', '</wrong>', /invalid sitemap XML/],
  ['sitemap includes 404', 'sitemap.xml', '</urlset>', '<url><loc>https://opentig.com/404</loc></url></urlset>', /sitemap does not match/],
  ['missing sitemap page', 'sitemap.xml', '<url><loc>https://opentig.com/</loc></url>', '', /sitemap does not match/],
  ['empty sitemap entry', 'sitemap.xml', '</urlset>', '<url/></urlset>', /one location/],
  ['duplicate sitemap URL', 'sitemap.xml', '</urlset>', '<url><loc>https://opentig.com/</loc></url></urlset>', /duplicate sitemap URLs/],
  ['blocked crawling', 'robots.txt', 'Allow: /', 'Disallow: /', /robots.txt policy/],
  ['wrong sitemap announcement', 'robots.txt', 'https://opentig.com/sitemap.xml', 'http://localhost/sitemap.xml', /robots.txt policy/],
  ['indexable error page', '404.html', '<meta name="robots" content="noindex">', '', /noindex policy/],
  ['missing Content Signals', 'robots.txt', 'Content-Signal: search=yes, ai-input=yes, ai-train=yes\n', '', /robots.txt policy/],
  ['missing Markdown alternate', 'index.html', '<link rel="alternate" type="text/markdown" href="/index.md">', '', /Markdown alternate/],
  ['wrong Markdown alternate', 'index.html', 'href="/index.md"', 'href="/llms.txt"', /Markdown alternate/],
  ['Markdown twin not announced', '_headers', '</index.md>; rel="alternate"; type="text/markdown", ', '', /does not announce \/index.md/],
  ['Link header to a missing file', '_headers', '</llms.txt>', '</missing.txt>', /missing local target/],
  ['llms.txt link to a missing page', 'llms.txt', '\n', '\n- [Missing](https://opentig.com/docs/missing/index.md)\n', /missing local target: \/docs\/missing/],
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

test('demo stays noindex and outside the sitemap in production', (t) => {
  const output = fixture(t);
  mkdirSync(join(output.directory, 'demo'));
  const demo = readFileSync(join(output.directory, 'index.html'), 'utf8')
    .replace(/<script type="application\/ld\+json">.*?<\/script>/s, '')
    .replace('</head>', '<meta name="robots" content="noindex"></head>')
    .replace('<link rel="alternate" type="text/markdown" href="/index.md">', '')
    .replace('rel="canonical" href="https://opentig.com/"', 'rel="canonical" href="https://opentig.com/demo/"')
    .replace('property="og:url" content="https://opentig.com/"', 'property="og:url" content="https://opentig.com/demo/"');
  output.write('demo/index.html', demo);
  assert.equal(output.validate(), 3);
  output.change('demo/index.html', '<meta name="robots" content="noindex">', '');
  assert.throws(output.validate, /noindex policy/);
  output.write('demo/index.html', demo.replace('</head>', '<link rel="alternate" type="text/markdown" href="/index.md"></head>'));
  assert.throws(output.validate, /unexpected Markdown alternate/);
  output.write('demo/index.html', demo);
  output.change('sitemap.xml', '</urlset>', '<url><loc>https://opentig.com/demo/</loc></url></urlset>');
  assert.throws(output.validate, /sitemap does not match/);
});

const guideSchema = (dateModified) => ({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'TechArticle', '@id': 'https://opentig.com/docs/#article', url: 'https://opentig.com/docs/', headline: 'OpenTig',
      description: 'Review & commit.', image: 'https://opentig.com/card.jpg', inLanguage: 'en', ...(dateModified && { dateModified }),
      isPartOf: { '@id': 'https://opentig.com/#website' }, about: { '@id': 'https://opentig.com/#application' },
      author: { '@id': 'https://opentig.com/#author' }, breadcrumb: { '@id': 'https://opentig.com/docs/#breadcrumb' } },
    { '@type': 'Person', '@id': 'https://opentig.com/#author', name: 'jorgefl8', url: 'https://github.com/jorgefl8' },
    { '@type': 'BreadcrumbList', '@id': 'https://opentig.com/docs/#breadcrumb', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'OpenTig', item: 'https://opentig.com/' },
      { '@type': 'ListItem', position: 2, name: 'Documentation', item: 'https://opentig.com/docs/' },
    ] },
  ],
});

/** Add an indexable documentation overview to a production fixture. */
function withGuide(output, { search = true, dateModified } = {}) {
  mkdirSync(join(output.directory, 'docs'));
  mkdirSync(join(output.directory, 'api'));
  const home = readFileSync(join(output.directory, 'index.html'), 'utf8');
  const page = home
    .replace('rel="canonical" href="https://opentig.com/"', 'rel="canonical" href="https://opentig.com/docs/"')
    .replace('property="og:url" content="https://opentig.com/"', 'property="og:url" content="https://opentig.com/docs/"')
    .replace('href="/index.md"', 'href="/docs/index.md"')
    .replace('property="og:type" content="website"', 'property="og:type" content="article"')
    .replace(/<script type="application\/ld\+json">.*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(guideSchema(dateModified))}</script>`);
  output.write('docs/index.html', page);
  output.write('docs/index.md', '# Documentation\n');
  output.change('_headers', '/docs/:page/', '/docs/\n  Link: </docs/index.md>; rel="alternate"; type="text/markdown"\n/docs/:page/');
  output.change('llms.txt', '\n', '\n- [Documentation](https://opentig.com/docs/index.md): Overview.\n');
  output.change('sitemap.xml', '</urlset>', `<url><loc>https://opentig.com/docs/</loc>${dateModified ? `<lastmod>${dateModified}</lastmod>` : ''}</url></urlset>`);
  if (search) output.write('api/docs-search.json', JSON.stringify({ docs: { docs: { 1: { url: '/docs/' } } } }));
  return { home, page };
}

test('documentation search must only point to published pages and real sections', (t) => {
  const output = fixture(t);
  const { home } = withGuide(output, { search: false });
  assert.throws(output.validate, /missing static documentation search index/);
  const index = url => output.write('api/docs-search.json', JSON.stringify({ docs: { docs: { 1: { url } } } }));
  index('/docs/#features%26more');
  assert.equal(output.validate(), 3);
  index('/docs');
  assert.equal(output.validate(), 3);
  index('/docs/#missing');
  assert.throws(output.validate, /documentation search: missing fragment/);
  index('/docs/development/');
  assert.throws(output.validate, /missing local target/);
  index('/demo/');
  assert.throws(output.validate, /non-documentation URL/);
  index('/docs/');
  mkdirSync(join(output.directory, 'docs', 'second'));
  output.write('docs/second/index.html', home);
  assert.throws(output.validate, /documentation page absent from search/);
});


test('published guide reading links stay on site while explicit editing links may open GitHub', (t) => {
  const output = fixture(t);
  const destination = 'https://github.com/jorgefl8/opentig/blob/main/docs/web-access.md#pairing-and-sessions';
  output.change('index.html', '</body>', `<a href="${destination}">Read guide</a></body>`);
  assert.throws(output.validate, /published documentation links to GitHub/);
  output.change('index.html', `<a href="${destination}">Read guide</a>`, `<a data-docs-source="true" href="${destination}">Edit on GitHub</a>`);
  assert.equal(output.validate(), 2);
});

test('reads the social image type and size from PNG and JPEG headers', () => {
  assert.deepEqual(imageSize(readFileSync(new URL('../public/opentig-social.jpg', import.meta.url))), { type: 'image/jpeg', width: 2400, height: 1260 });
  assert.deepEqual(imageSize(readFileSync(new URL('../public/opentig-social.png', import.meta.url))), { type: 'image/png', width: 1200, height: 630 });
  for (const bytes of [Buffer.alloc(0), Buffer.from('GIF89a'), Buffer.from([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0])]) assert.equal(imageSize(bytes), undefined);
});

test('guides are dated articles with breadcrumbs that agree with the sitemap', (t) => {
  const date = '2026-11-05T21:03:22+01:00';
  const output = fixture(t);
  const { page } = withGuide(output, { dateModified: date });
  assert.equal(output.validate(), 3);
  const rejects = (file, before, after, error) => {
    output.change(file, before, after);
    assert.throws(output.validate, error);
    output.change(file, after, before);
  };
  rejects('docs/index.html', 'og:type" content="article', 'og:type" content="website', /incorrect website identity/);
  rejects('docs/index.html', '"headline":"OpenTig"', '"headline":"Other"', /article identity differs/);
  rejects('docs/index.html', '"item":"https://opentig.com/docs/"', '"item":"https://opentig.com/docs/missing/"', /missing local target/);
  rejects('docs/index.html', '"position":2', '"position":3', /breadcrumb 2 is malformed/);
  rejects('docs/index.html', '{"@id":"https://opentig.com/#author"},"breadcrumb"', '{"@id":"https://opentig.com/#someone"},"breadcrumb"', /schema entity links differ/);
  rejects('sitemap.xml', `<lastmod>${date}</lastmod>`, '<lastmod>2026-11-04</lastmod>', /article and sitemap dates differ/);
  rejects('sitemap.xml', `<lastmod>${date}</lastmod>`, '<lastmod>5 November 2026</lastmod>', /invalid or future sitemap date/);
  rejects('sitemap.xml', `<lastmod>${date}</lastmod>`, '<lastmod>2999-01-01</lastmod>', /invalid or future sitemap date/);
  rejects('sitemap.xml', `<lastmod>${date}</lastmod>`, `<lastmod>${date}</lastmod><lastmod>${date}</lastmod>`, /one modification date/);
  output.write('docs/index.html', page.replace(/<script type="application\/ld\+json">.*?<\/script>/, ''));
  assert.throws(output.validate, /expected one JSON-LD script/);
});

test('sitemap dates are optional when Git history is unavailable', (t) => {
  const output = fixture(t);
  withGuide(output);
  assert.equal(output.validate(), 3);
  output.change('sitemap.xml', '<loc>https://opentig.com/</loc>', '<loc>https://opentig.com/</loc><lastmod>2026-11-05</lastmod>');
  assert.equal(output.validate(), 3);
});

test('the homepage names its author and only a version that matches its installer', (t) => {
  const output = fixture(t);
  output.change('index.html', /,\{"@type":"Person".*?\}\]/, ']');
  assert.throws(output.validate, /missing or duplicate schema entities/);
  const versioned = fixture(t);
  const installer = 'https://github.com/jorgefl8/opentig/releases/download/v1.0.0/OpenTig-1.0.0-win32-x64-Setup.exe';
  versioned.change('index.html', '"url":"https://github.com/jorgefl8/opentig/releases/latest"}', `"url":"${installer}"},"softwareVersion":"1.0.0","downloadUrl":"${installer}"`);
  assert.equal(versioned.validate(), 2);
  versioned.change('index.html', '"softwareVersion":"1.0.0"', '"softwareVersion":"1.0.1"');
  assert.throws(versioned.validate, /version must match its installer/);
});
