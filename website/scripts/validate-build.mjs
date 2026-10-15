import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parse } from 'parse5';
import { documentationRoutes } from '../docs.config.mjs';
import { SaxesParser } from 'saxes';

const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const text = (node) => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
const walk = (node) => [node, ...(node.childNodes ?? []).flatMap(walk)];
const tokens = (value = '') => value.toLowerCase().split(/[\s,]+/);
const check = (condition, message) => assert.ok(condition, `SEO: ${message}`);

function filesIn(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}${entry.name}`;
    return entry.isDirectory() ? filesIn(directory, `${name}/`) : [name];
  });
}

function publicUrl(value, base) {
  const url = new URL(value, base);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  check(!/^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/.test(host)
    && !/\.(localhost|local|test|invalid)$/.test(host), `local or private URL: ${value}`);
  check(['https:', 'http:'].includes(url.protocol), `unsupported URL: ${value}`);
  return url;
}

function sitemapLocations(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  const locations = [];
  let urlCount = 0;
  let location = '';
  parser.on('error', (error) => { throw new Error(`SEO: invalid sitemap XML: ${error.message}`, { cause: error }); });
  parser.on('opentag', (tag) => {
    check(tag.uri === 'http://www.sitemaps.org/schemas/sitemap/0.9', 'incorrect sitemap namespace');
    const parent = stack.at(-1);
    check((!parent && tag.local === 'urlset') || (parent === 'urlset' && tag.local === 'url')
      || (parent === 'url' && tag.local === 'loc'), `unexpected sitemap element: ${tag.local}`);
    stack.push(tag.local);
    if (tag.local === 'url') urlCount++;
    if (tag.local === 'loc') location = '';
  });
  parser.on('text', (value) => { if (stack.at(-1) === 'loc') location += value; });
  parser.on('closetag', () => { if (stack.pop() === 'loc') locations.push(location.trim()); });
  parser.write(xml).close();
  check(urlCount === locations.length, 'each sitemap URL must have one location');
  return locations;
}

/** Validate final static output without making network requests. */
export function validateBuild({ directory, site, indexable }) {
  check(typeof indexable === 'boolean', 'expected indexing policy is missing');
  const origin = publicUrl(site);
  check(origin.protocol === 'https:' && origin.pathname === '/' && !origin.search && !origin.hash,
    'site must be an HTTPS origin without a path, query, or fragment');
  const root = resolve(directory);
  const files = new Set(filesIn(root));
  for (const required of ['index.html', '404.html', 'robots.txt', 'sitemap.xml']) check(files.has(required), `missing ${required}`);
  const pages = new Map();
  for (const file of files) {
    if (!file.endsWith('.html')) continue;
    const nodes = walk(parse(readFileSync(join(root, file), 'utf8')));
    const head = nodes.find((node) => node.tagName === 'head');
    const route = file === 'index.html' ? '/' : `/${file.replace(/index\.html$/, '').replace(/\.html$/, '')}`;
    pages.set(file, { nodes, headNodes: walk(head), route, ids: new Set(nodes.map((node) => attr(node, 'id')).filter(Boolean)) });
  }
  const targetFile = (url) => {
    const path = decodeURIComponent(url.pathname).replace(/^\//, '');
    const resolved = resolve(root, path);
    check(resolved === root || resolved.startsWith(`${root}${sep}`), `path escapes output: ${url}`);
    const candidates = [path, `${path.replace(/\/$/, '')}/index.html`, `${path}.html`];
    if (!path) candidates.unshift('index.html');
    const target = candidates.find((candidate) => files.has(candidate));
    check(target, `missing local target: ${url.pathname}`);
    return target;
  };
  const checkReference = (value, base, label) => {
    if (/^(data:|mailto:|tel:)/i.test(value)) return;
    check(value.trim() && value !== '#', `${label}: empty or placeholder URL`);
    const url = publicUrl(value, base);
    if (url.origin !== origin.origin) return;
    const target = targetFile(url);
    if (url.hash && pages.has(target)) check(pages.get(target).ids.has(decodeURIComponent(url.hash.slice(1))), `${label}: missing fragment ${url.hash}`);
  };
  if ([...pages.keys()].some(file => file.startsWith('docs/'))) {
    check(files.has('api/docs-search.json'), 'missing static documentation search index');
    const search = JSON.parse(readFileSync(join(root, 'api/docs-search.json'), 'utf8'));
    const records = Object.values(search.docs?.docs ?? {});
    check(records.length > 0, 'empty documentation search index');
    for (const record of records) {
      check(record.url?.startsWith('/docs'), 'search includes a non-documentation URL');
      checkReference(record.url, origin, 'documentation search');
    }
    const indexedPages = new Set(records.map(record => record.url?.split(/[?#]/)[0].replace(/\/$/, '')));
    for (const page of pages.values()) {
      if (page.route.startsWith('/docs/')) check(indexedPages.has(page.route.replace(/\/$/, '')), `documentation page absent from search: ${page.route}`);
    }
  }
  const expectedLocations = [];
  for (const [file, page] of pages) {
    const { nodes, headNodes, route } = page;
    const label = `${file}:`;
    const url = new URL(route, origin).href;
    const errorPage = file === '404.html';
    const demoPage = file === 'demo/index.html';
    const meta = (key, optional = false) => {
      const matches = headNodes.filter((node) => node.tagName === 'meta' && (attr(node, 'name') === key || attr(node, 'property') === key));
      check(matches.length === 1 || (optional && matches.length === 0), `${label} expected one ${key} meta tag`);
      const value = matches.length ? attr(matches[0], 'content') : undefined;
      if (matches.length) check(value?.trim(), `${label} empty ${key}`);
      return value;
    };
    const titles = headNodes.filter((node) => node.tagName === 'title');
    check(titles.length === 1 && text(titles[0]).trim(), `${label} missing or duplicate title`);
    check(nodes.some((node) => node.tagName === 'h1' && text(node).trim()), `${label} missing heading`);
    check(attr(nodes.find((node) => node.tagName === 'html'), 'lang') === 'en', `${label} expected English document`);
    const description = meta('description');
    for (const prefix of ['og', 'twitter']) {
      check(meta(`${prefix}:title`) === text(titles[0]), `${label} ${prefix} title differs`);
      check(meta(`${prefix}:description`) === description, `${label} ${prefix} description differs`);
    }
    const robots = tokens(meta('robots', true));
    const noindex = robots.includes('noindex') || robots.includes('none');
    check(noindex === (errorPage || demoPage || !indexable), `${label} incorrect noindex policy`);
    for (const agent of ['googlebot', 'bingbot']) check(!meta(agent, true), `${label} crawler-specific override needs review`);
    const canonicals = headNodes.filter((node) => node.tagName === 'link' && tokens(attr(node, 'rel')).includes('canonical'));
    if (errorPage) {
      check(canonicals.length === 0 && !meta('og:url', true), `${label} error page must not have a canonical URL`);
    } else {
      check(canonicals.length === 1 && attr(canonicals[0], 'href') === url, `${label} incorrect canonical`);
      check(meta('og:url') === url, `${label} incorrect og:url`);
      if (indexable && !demoPage) expectedLocations.push(url);
    }
    check(meta('og:type') === 'website' && meta('og:site_name') === 'OpenTig', `${label} incorrect website identity`);
    check(meta('twitter:card') === 'summary_large_image', `${label} expected large social card`);
    const image = publicUrl(meta('og:image'));
    check(image.origin === origin.origin && image.protocol === 'https:', `${label} social image must use the public origin`);
    check(meta('twitter:image') === image.href && meta('twitter:image:alt') === meta('og:image:alt'), `${label} social images or alternatives differ`);
    const png = readFileSync(join(root, targetFile(image)));
    check(png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${label} social image is not PNG`);
    check(meta('og:image:type') === 'image/png' && Number(meta('og:image:width')) === png.readUInt32BE(16)
      && Number(meta('og:image:height')) === png.readUInt32BE(20), `${label} social image dimensions or type differ`);
    for (const node of nodes) {
      for (const attribute of ['href', 'src', 'poster']) {
        const value = attr(node, attribute);
        if (value !== undefined) {
          checkReference(value, url, label);
          const repositoryPrefix = 'https://github.com/jorgefl8/opentig/blob/main/';
          if (attribute === 'href' && value.startsWith(repositoryPrefix) && !attr(node, 'data-docs-source')) {
            const source = decodeURIComponent(new URL(value).pathname.slice(new URL(repositoryPrefix).pathname.length));
            check(!documentationRoutes.has(source), `${label} published documentation links to GitHub: ${value}`);
          }
        }
      }
    }
    const scripts = nodes.filter((node) => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json');
    if (errorPage || demoPage || !indexable) check(scripts.length === 0, `${label} unexpected structured data on noindex page`);
    else if (route === '/') {
      check(scripts.length === 1 && headNodes.includes(scripts[0]), `${label} expected one JSON-LD script in head`);
      const schema = JSON.parse(text(scripts[0]));
      check(schema['@context'] === 'https://schema.org' && Array.isArray(schema['@graph']), `${label} invalid schema graph`);
      const graph = schema['@graph'];
      const websites = graph.filter((item) => item['@type'] === 'WebSite');
      const apps = graph.filter((item) => item['@type'] === 'SoftwareApplication');
      check(websites.length === 1 && apps.length === 1, `${label} missing or duplicate schema entities`);
      const [web] = websites; const [app] = apps;
      check(web.name === 'OpenTig' && app.name === web.name && web.url === url && app.url === url, `${label} schema identity differs`);
      check(web['@id'] === `${url}#website` && app['@id'] === `${url}#application` && web.about?.['@id'] === app['@id'], `${label} schema entity links differ`);
      check(web.inLanguage === 'en' && app.description === description, `${label} schema language or description differs`);
      check(app.applicationCategory === 'DeveloperApplication' && app.applicationSubCategory === 'Git client', `${label} schema category differs`);
      check(app.isAccessibleForFree === true && app.offers?.['@type'] === 'Offer' && [0, '0'].includes(app.offers.price), `${label} schema free availability differs`);
      for (const key of ['aggregateRating', 'review', 'softwareVersion']) check(!(key in app), `${label} ${key} requires verified data and updated checks`);
      check(Array.isArray(app.operatingSystem) && app.operatingSystem.length > 0 && app.softwareRequirements?.trim(), `${label} missing platforms or requirements`);
      for (const value of [app.license, app.sameAs, app.installUrl, app.offers.url]) {
        check(typeof value === 'string' && publicUrl(value).protocol === 'https:', `${label} missing public application URL`);
      }
      const inspect = (value) => {
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) publicUrl(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
      };
      inspect(schema);
    }
  }
  const locations = sitemapLocations(readFileSync(join(root, 'sitemap.xml'), 'utf8'));
  check(new Set(locations).size === locations.length, 'duplicate sitemap URLs');
  check(JSON.stringify([...locations].sort()) === JSON.stringify(expectedLocations.sort()), 'sitemap does not match indexable canonical pages');
  const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
  const rules = robots.split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).filter(Boolean);
  const expectedRules = ['User-agent: *', 'Allow: /', ...(indexable ? [`Sitemap: ${new URL('/sitemap.xml', origin)}`] : [])];
  check(JSON.stringify(rules) === JSON.stringify(expectedRules), 'robots.txt policy or sitemap announcement differs');
  // Fonts and images referenced by the generated CSS must also exist locally.
  for (const file of files) {
    if (!file.endsWith('.css')) continue;
    const css = readFileSync(join(root, file), 'utf8');
    for (const match of css.matchAll(/url\(\s*['"]?([^\s'")]+)['"]?\s*\)/g)) checkReference(match[1], new URL(file, origin), file);
  }
  return pages.size;
}
