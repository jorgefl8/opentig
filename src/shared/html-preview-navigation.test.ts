// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { installHtmlPreviewNavigation } from './html-preview-navigation';

it('runs the serialized bridge, intercepts document links, preserves native fragments and validates anchor messages', () => {
  const listeners: [string, EventListener][] = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener as EventListener]);
    add(type, listener, options);
  });
  const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const scroll = vi.fn();
  const scrollTop = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  document.body.innerHTML = '<a href="requirements.html#section"><span>Requirements</span></a><a href="#section">Section</a><h2 id="section">Section</h2>';
  document.getElementById('section')!.scrollIntoView = scroll;
  try {
    window.eval(`(${installHtmlPreviewNavigation.toString()})("preview-id")`);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    document.querySelector('span')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: 'opentig:html-link', navigationId: 'preview-id', href: 'requirements.html#section' }, window.location.origin);
    post.mockClear();
    const fragmentClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a[href="#section"]')!.dispatchEvent(fragmentClick);
    expect(fragmentClick.defaultPrevented).toBe(false);
    expect(post).not.toHaveBeenCalled();
    const handledClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    handledClick.preventDefault();
    document.querySelector('span')!.dispatchEvent(handledClick);
    expect(post).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(post).toHaveBeenCalledWith({ type: 'opentig:html-ready', navigationId: 'preview-id', href: undefined }, window.location.origin);

    const data = { type: 'opentig:html-anchor', navigationId: 'preview-id', hash: '#section' };
    window.dispatchEvent(new MessageEvent('message', { data, source: null, origin: window.location.origin }));
    window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: 'https://other.example' }));
    window.dispatchEvent(new MessageEvent('message', { data: { ...data, navigationId: 'old' }, source: window, origin: window.location.origin }));
    expect(scroll).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
    expect(scroll).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#section');
    window.dispatchEvent(new MessageEvent('message', { data: { ...data, hash: '' }, source: window, origin: window.location.origin }));
    expect(scrollTop).toHaveBeenCalledWith(0, 0);
  } finally {
    for (const [type, listener] of listeners) window.removeEventListener(type, listener);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  }
});
