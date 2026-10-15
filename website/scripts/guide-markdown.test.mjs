import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loader } from 'fumadocs-core/source';
import { publishedGuides, documentationSections, documentationUrls } from '../docs.config.mjs';
import { guideMarkdown, guideTables } from './guide-markdown.mjs';

const link = (url, text = 'Guide') => ({ type: 'link', url, children: [{ type: 'text', value: text }] });
const rewrite = (urls, source) => {
  const tree = { children: urls.map(url => link(url)) };
  guideMarkdown({ source })(tree);
  return tree.children.map(node => node.url);
};

test('removes duplicate titles and repository breadcrumbs without removing code or companion links', () => {
  const code = { type: 'code', value: '# Title\n[← Documentation](README.md)' };
  const tree = { children: [
    { type: 'heading', depth: 1 },
    { type: 'paragraph', children: [link('README.md', '← Documentation')] },
    { type: 'paragraph', children: [link('README.md', '← Documentation'), { type: 'text', value: ' · ' }, link('features.md')] },
    { type: 'paragraph', children: [link('README.md', 'Documentation')] },
    { type: 'heading', depth: 2 }, code,
  ] };
  guideMarkdown({ source: 'docs/github.md' })(tree);
  assert.deepEqual(tree.children, [
    { type: 'paragraph', children: [link('/docs/features/')] },
    { type: 'paragraph', children: [link('/docs/', 'Documentation')] },
    { type: 'heading', depth: 2 }, code,
  ]);
});

test('rewrites relative and explicit GitHub guide links, preserving queries, anchors and external references', () => {
  assert.deepEqual(rewrite([
    './getting-started.md?from=guide#requirements', 'web-access.md#connection-behavior',
    'https://github.com/jorgefl8/opentig/blob/main/docs/github.md#create-a-pull-request',
    '../CONTRIBUTING.md', '../README.md', '../src/main/index.ts', 'unpublished.md',
    '#requirements', '/demo/', 'https://example.com', 'https://github.com/other/repo/blob/main/docs/features.md',
  ], 'docs/features.md'), [
    '/docs/getting-started/?from=guide#requirements', '/docs/web-access/#connection-behavior',
    '/docs/github/#create-a-pull-request', '/docs/contributing/', '/',
    'https://github.com/jorgefl8/opentig/blob/main/src/main/index.ts',
    'https://github.com/jorgefl8/opentig/blob/main/docs/unpublished.md',
    '#requirements', '/demo/', 'https://example.com', 'https://github.com/other/repo/blob/main/docs/features.md',
  ]);
});

test('uses the original file location for root-level guides and reference-style links', () => {
  const tree = { children: [{ type: 'definition', url: 'docs/development.md#run-from-source' }] };
  guideMarkdown()(tree, { path: fileURLToPath(new URL('../../CONTRIBUTING.md', import.meta.url)) });
  assert.equal(tree.children[0].url, '/docs/development/#run-from-source');
  assert.deepEqual(rewrite(['docs/website.md'], 'THIRD_PARTY_NOTICES.md'), ['/docs/website/']);
});

test('every published source resolves locally and appears once in navigation', () => {
  const navigation = documentationSections.flatMap(section => section.pages);
  assert.equal(new Set(navigation).size, navigation.length);
  assert.deepEqual([...navigation].sort(), ['index', ...Object.keys(publishedGuides)].sort());
  for (const [slug, guide] of Object.entries(publishedGuides)) {
    assert.deepEqual(rewrite([guide.source], 'README.md'), [`/docs/${slug}/`]);
  }
});

test('wide tables remain semantic tables inside a focusable scroll region', () => {
  const table = { type: 'element', tagName: 'table', children: [] };
  const root = { children: [table] };
  guideTables()(root);
  assert.equal(root.children[0].properties.tabIndex, 0);
  assert.equal(root.children[0].properties.role, 'region');
  assert.equal(root.children[0].children[0], table);
});


test('Fumadocs navigation and search source URLs match Astro trailing-slash routes', () => {
  const source = loader({ files: [
    { type: 'page', path: 'index.md', data: { title: 'Overview' } },
    { type: 'page', path: 'github.md', data: { title: 'GitHub' } },
  ] }, { baseUrl: '/docs', plugins: [documentationUrls] });
  assert.deepEqual(source.getPages().map(page => page.url).sort(), ['/docs/', '/docs/github/']);
  assert.deepEqual(source.getPageTree().children.map(page => page.url).sort(), ['/docs/', '/docs/github/']);
  assert.equal(source.getPageByUrl('/docs/github/').data.title, 'GitHub');
});
