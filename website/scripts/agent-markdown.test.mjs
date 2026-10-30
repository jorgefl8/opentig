import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSignals, markdownPath } from './agent-access.mjs';
import { pageMarkdown, siteMarkdown } from './agent-markdown.mjs';

test('Markdown twins sit beside each trailing-slash route', () => {
  assert.equal(markdownPath('/'), '/index.md');
  assert.equal(markdownPath('/docs/github/'), '/docs/github/index.md');
  assert.throws(() => markdownPath('/docs/github'), /trailing slash/);
  assert.match(contentSignals, /^search=yes, ai-input=yes, ai-train=(yes|no)$/);
});

test('page Markdown keeps the rendered page links, tables and code', async () => {
  const markdown = await pageMarkdown({
    title: 'GitHub and pull requests',
    description: 'Review pull requests.',
    source: 'docs/github.md',
    body: '# GitHub\n\n[← Documentation](README.md)\n\nSee [features](features.md#diffs) and [code](../src/main.ts).\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```bash\n# not a heading\n```\n',
  });
  assert.equal(markdown, [
    '# GitHub and pull requests', '', '> Review pull requests.', '',
    'See [features](/docs/features/#diffs) and [code](https://github.com/jorgefl8/opentig/blob/main/src/main.ts).', '',
    '| A | B |', '| - | - |', '| 1 | 2 |', '',
    '```bash', '# not a heading', '```', '',
  ].join('\n'));
});

test('site overview follows the llms.txt layout with absolute Markdown links', () => {
  assert.equal(siteMarkdown({
    site: new URL('https://opentig.com/'),
    description: 'A Git client.',
    details: ['Free and open source.'],
    sections: [{ title: 'Get started', pages: [{ title: 'Install', description: 'Set it up.', markdown: '/docs/getting-started/index.md' }] }],
  }), '# OpenTig\n\n> A Git client.\n\nFree and open source.\n\n## Get started\n\n- [Install](https://opentig.com/docs/getting-started/index.md): Set it up.\n');
});
