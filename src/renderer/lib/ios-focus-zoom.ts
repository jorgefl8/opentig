/** iOS, including iPads that report themselves as Macs. Every browser there is WebKit. */
export function isIos(navigatorLike: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator): boolean {
  return /iP(hone|ad|od)/.test(navigatorLike.userAgent) || (navigatorLike.platform === 'MacIntel' && navigatorLike.maxTouchPoints > 1);
}

/**
 * iOS zooms in when text under 16px gets focus, which would make editing code at its
 * reading size jump. With maximum-scale=1 it doesn't, while pinch zoom still works,
 * since iOS ignores that limit for the user. Elsewhere the limit would block pinch
 * zoom, and focus doesn't zoom, so it's iOS only.
 */
export function preventIosFocusZoom(doc: Document = document, ios = isIos()): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!ios || !meta || /maximum-scale/.test(meta.content)) return;
  meta.content = `${meta.content}, maximum-scale=1`;
}
