/** Runs inside the opaque-origin preview. Keep this function self-contained: the server serializes it. */
export function installHtmlPreviewNavigation(navigationId: string): void {
  const post = (type: string, href?: string) => {
    window.parent.postMessage({ type, navigationId, href }, window.location.origin);
  };
  window.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0) return;
    const element = event.composedPath().find(node => node instanceof Element) as Element | undefined;
    const link = element?.closest('a[href], area[href]');
    const href = link?.getAttribute('href')?.trim();
    // Native fragment links retain :target, history, and the document's own handlers.
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return;
    event.preventDefault();
    post('opentig:html-link', href);
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.type !== 'opentig:html-anchor' || message.navigationId !== navigationId
      || typeof message.hash !== 'string' || message.hash.length > 8192) return;
    const hash = message.hash;
    if (hash && !hash.startsWith('#')) return;
    window.location.hash = hash;
    if (!hash || hash === '#') { window.scrollTo(0, 0); return; }
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
    target?.scrollIntoView();
  });
  window.addEventListener('load', () => post('opentig:html-ready'), { once: true });
}
