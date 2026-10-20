import { expect, it } from 'vitest';
import { resolveHtmlPreviewLink } from './html-preview-links';

it.each([
  ['requirements.html', 'docs/requirements.html', ''],
  ['./requirements.html#D-11', 'docs/requirements.html', '#D-11'],
  ['../manual/a%20b.PDF?page=2', 'manual/a b.PDF', ''],
  ['/guide.html#secci%C3%B3n', 'guide.html', '#secci%C3%B3n'],
  ['#summary', 'docs/workflow.html', '#summary'],
  ['?filter=all#summary', 'docs/workflow.html', '#summary'],
])('resolves %s relative to the document, retaining its fragment', (href, path, hash) => {
  expect(resolveHtmlPreviewLink('docs/workflow.html', href)).toEqual({ type: 'file', path, hash });
});

it.each(['https://example.com/guide', '//example.com/guide', 'mailto:hello@example.com'])('routes %s as an external link', href => {
  expect(resolveHtmlPreviewLink('docs/workflow.html', href)?.type).toBe('external');
});

it.each(['../../escape.html', '%2e%2e/%2e%2e/escape.html', '/.git/config', '../.GIT/config', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', '%00.html', '%invalid', '', 'a'.repeat(8193), null, {}])('rejects unsafe or malformed links: %s', href => {
  expect(resolveHtmlPreviewLink('docs/workflow.html', href)).toBeNull();
});
