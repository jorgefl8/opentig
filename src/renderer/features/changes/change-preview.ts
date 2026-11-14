import { isKnownImagePath } from '../../../shared/image-types';

/**
 * Text formats, including HTML, SVG and Markdown, open their diff. Only raster
 * images open a preview, because their diff has nothing readable in it.
 */
export function shouldOpenChangePreview(path: string, kind: string): boolean {
  const directorySummary = path.endsWith('/') || path.endsWith('\\');
  if (directorySummary || kind === 'deleted') return false;
  return isKnownImagePath(path);
}
