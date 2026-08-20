import { isKnownImagePath, isSvgPath } from '../../../shared/image-types';
import { isHtmlPath } from '../files/file-tree';

/** Markdown changes default to their diff; only visual formats open a preview. */
export function shouldOpenChangePreview(path: string, kind: string): boolean {
  const directorySummary = path.endsWith('/') || path.endsWith('\\');
  if (directorySummary || kind === 'deleted') return false;
  return isHtmlPath(path) || isSvgPath(path) || isKnownImagePath(path);
}
