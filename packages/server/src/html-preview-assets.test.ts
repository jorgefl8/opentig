import { expect, it, vi } from 'vitest';
import { embedHtmlPreviewAssets } from './html-preview-assets';

it('embeds sibling CSS and module scripts, resolving nested CSS images, fonts and imports', async () => {
  const files: Record<string, string> = {
    'docs/site.css': '@import "nested/theme.css"; body { background: url("../image.svg"); }',
    'docs/nested/theme.css': '@font-face { src: url("../../font.woff2") }',
    'docs/site.js': 'document.body.dataset.ready = "yes";',
    'image.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'font.woff2': 'font',
  };
  const read = vi.fn(async (path: string) => ({ data: Buffer.from(files[path]!), size: files[path]!.length }));
  const html = await embedHtmlPreviewAssets('<link rel="stylesheet" href="site.css"><script type="module" src="site.js"></script><h1>Preview</h1>', 'docs/index.html', read);
  expect(html).toContain('<h1>Preview</h1>');
  expect(html).toContain('type="module" src="data:text/javascript;base64,');
  const stylesheet = Buffer.from(/href="data:text\/css;base64,([^"]+)"/.exec(html)![1]!, 'base64').toString();
  expect(stylesheet).toContain('@import url("data:text/css;base64,');
  expect(stylesheet).toContain('url("data:image/svg+xml;base64,');
  expect(read.mock.calls.map(call => call[0])).toEqual(['docs/site.css', 'docs/nested/theme.css', 'font.woff2', 'image.svg', 'docs/site.js']);
});

it('never reads remote URLs, escaping paths, Git metadata, unknown types or denied symlinks', async () => {
  const read = vi.fn(async () => { throw new Error('outside the worktree'); });
  const html = await embedHtmlPreviewAssets('<base href="https://example.com"><script src="https://example.com/app.js"></script><img src="../../private.svg"><img src="%2e%2e/%2e%2e/private.svg"><img src="/.git/config"><img src="config.json"><img src="linked.svg">', 'docs/index.html', read);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('docs/linked.svg', expect.any(Number));
  expect(html).toContain('<base>');
  expect(html).toContain('src="https://example.com/app.js"');
  expect(html.match(/src="data:,"/g)).toHaveLength(5);
});

it('bounds reads and breaks circular CSS imports', async () => {
  const read = vi.fn(async () => ({ data: Buffer.from('@import "site.css";'), size: 19 }));
  const html = await embedHtmlPreviewAssets('<link rel="stylesheet" href="site.css">', 'index.html', read);
  expect(read).toHaveBeenCalledTimes(1);
  expect(Buffer.from(/base64,([^"]+)/.exec(html)![1]!, 'base64').toString()).toContain('url("data:,")');
  const oversized = await embedHtmlPreviewAssets('<script src="big.js"></script>', 'index.html', async () => ({ data: null, size: 9_000_000 }));
  expect(oversized).toContain('src="data:,"');
});
