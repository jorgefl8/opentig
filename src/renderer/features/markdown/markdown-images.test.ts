// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenTigApi } from '@shared/contracts';
import { mountMarkdownImages } from './markdown-images';
import { renderMarkdown } from './render-markdown';

const ready = {
  status: 'ready' as const, path: 'image.png', mimeType: 'image/png' as const,
  data: new Uint8Array([137, 80, 78, 71]), size: 4, mtimeMs: 1,
};

function fixture() {
  const create = vi.fn<(blob: Blob) => string>(() => `blob:image-${Math.random()}`);
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
  const repository = {
    readImage: vi.fn<OpenTigApi['repository']['readImage']>().mockResolvedValue(ready),
    readFile: vi.fn<OpenTigApi['repository']['readFile']>().mockResolvedValue({
      path: 'logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      binary: false, tooLarge: false, size: 45, mtimeMs: 1,
    }),
  };
  const container = document.createElement('div');
  return { create, revoke, repository, container };
}

afterEach(() => vi.unstubAllGlobals());

describe('repository Markdown images', () => {
  it('loads rendered Markdown and HTML images relative to the document, deduplicates reads, and releases blobs', async () => {
    const { container, repository, create, revoke } = fixture();
    const html = await renderMarkdown('<img src="../public/logo.svg" width="36" alt="Logo">\n\n![Screenshot](images/a%20b.png)\n\n![Again](images/a%20b.png)');
    const cleanup = mountMarkdownImages(container, html, 'repo', 'docs/README.md', repository);
    expect([...container.querySelectorAll('img')].every(image => !image.hasAttribute('src'))).toBe(true);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(repository.readFile).toHaveBeenCalledWith('repo', 'public/logo.svg');
    expect(repository.readImage).toHaveBeenCalledExactlyOnceWith('repo', 'docs/images/a b.png');
    const images = container.querySelectorAll('img');
    expect(images[0]!.getAttribute('width')).toBe('36');
    expect(images[0]!.alt).toBe('Logo');
    expect(images[0]!.src).toMatch(/^blob:/);
    expect(images[1]!.src).toBe(images[2]!.src);
    expect(create.mock.calls.map(call => call[0].type).sort()).toEqual(['image/png', 'image/svg+xml']);
    cleanup();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('preserves remote images and code icons, and prevents invalid local paths from reaching the server', async () => {
    const { container, repository } = fixture();
    const html = await renderMarkdown('![Remote](https://example.com/a.png)\n\n![Outside](../../a.png)\n\n![Root](/images/root.png)');
    const cleanup = mountMarkdownImages(container, `${html}<img class="markdown-code-icon" src="/assets/code.svg">`, 'repo', 'docs/README.md', repository);
    await vi.waitFor(() => expect(container.querySelector('img[alt="Root"]')?.getAttribute('src')).toMatch(/^blob:/));
    expect(repository.readImage).toHaveBeenCalledExactlyOnceWith('repo', 'images/root.png');
    expect(container.querySelector('img[alt="Outside"]')?.hasAttribute('src')).toBe(false);
    expect(container.querySelector('img[alt="Remote"]')?.getAttribute('src')).toBe('https://example.com/a.png');
    expect(container.querySelector('.markdown-code-icon')?.getAttribute('src')).toBe('/assets/code.svg');
    cleanup();
  });

  it('ignores reads completing after the document is disposed', async () => {
    const { container, repository, create } = fixture();
    let resolve!: (value: typeof ready) => void;
    repository.readImage.mockReturnValue(new Promise(done => { resolve = done; }));
    const cleanup = mountMarkdownImages(container, '<img src="image.png">', 'first-repo', 'README.md', repository);
    cleanup();
    resolve(ready);
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
    expect(container.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('keeps the document and alt text when images are missing, too large, or unsupported', async () => {
    const { container, repository, create } = fixture();
    repository.readImage.mockRejectedValueOnce(new Error('Missing')).mockResolvedValueOnce({
      status: 'unsupported', path: 'bad.png', size: 1, mtimeMs: 1,
    }).mockResolvedValueOnce({
      status: 'too-large', path: 'large.png', size: 100, mtimeMs: 1, limit: 10, mimeType: 'image/png',
    });
    repository.readFile.mockResolvedValue({ path: 'large.svg', content: '', binary: false, tooLarge: true, size: 100, mtimeMs: 1 });
    const html = await renderMarkdown('# Document\n\n![Missing](missing.png)\n\n![Bad](bad.png)\n\n![Large](large.png)\n\n![SVG](large.svg)');
    const cleanup = mountMarkdownImages(container, html, 'repo', 'README.md', repository);
    await Promise.resolve();
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('Document');
    expect([...container.querySelectorAll('img')].map(image => image.alt)).toEqual(['Missing', 'Bad', 'Large', 'SVG']);
    cleanup();
  });
});
