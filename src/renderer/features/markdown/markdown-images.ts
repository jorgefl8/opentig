import type { OpenTigApi } from '@shared/contracts';
import { isSvgPath } from '@shared/image-types';
import { resolveMarkdownRepositoryPath } from './markdown-links';

/** Install sanitized Markdown without sending repository image paths to the web server. */
export function mountMarkdownImages(
  container: HTMLElement,
  html: string,
  repositoryId: string,
  markdownPath: string,
  repository: Pick<OpenTigApi['repository'], 'readImage' | 'readFile'>,
): () => void {
  const template = document.createElement('template');
  template.innerHTML = html;
  const images = new Map<string, HTMLImageElement[]>();
  for (const image of template.content.querySelectorAll<HTMLImageElement>('img[src]')) {
    // Code fence icons are application assets, not repository files.
    if (image.classList.contains('markdown-code-icon')) continue;
    const source = image.getAttribute('src')!.trim();
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) continue;
    image.removeAttribute('src');
    image.removeAttribute('srcset');
    const path = resolveMarkdownRepositoryPath(markdownPath, source);
    if (!path) continue;
    const targets = images.get(path) ?? [];
    targets.push(image);
    images.set(path, targets);
  }
  container.replaceChildren(template.content);

  let disposed = false;
  const urls: string[] = [];
  for (const [path, targets] of images) {
    void (async () => {
      let blob: Blob;
      if (isSvgPath(path)) {
        const file = await repository.readFile(repositoryId, path);
        if (file.binary || file.tooLarge) return;
        // SVG stays in an image context, where scripts and external resources are disabled.
        blob = new Blob([file.content], { type: 'image/svg+xml' });
      } else {
        const image = await repository.readImage(repositoryId, path);
        if (image.status !== 'ready') return;
        blob = new Blob([new Uint8Array(image.data)], { type: image.mimeType });
      }
      if (disposed) return;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      for (const image of targets) image.src = url;
    })().catch(() => {
      // Missing, unsupported, or inaccessible images keep their alternative text.
    });
  }
  return () => {
    disposed = true;
    for (const url of urls) URL.revokeObjectURL(url);
  };
}
