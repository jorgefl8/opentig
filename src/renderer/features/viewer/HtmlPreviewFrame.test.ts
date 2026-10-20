// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HtmlPreviewFrame } from './HtmlPreviewFrame';
import { openExternalUrl } from '@/lib/browser-capabilities';

vi.mock('@/lib/browser-capabilities', () => ({ openExternalUrl: vi.fn() }));

it('keeps the installed-app preview sandboxed and posts updated drafts only while active', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (document: string, active: boolean) => act(async () => {
    root.render(createElement(HtmlPreviewFrame, { document, repositoryId: 'repo', path: 'index.html', active, anchor: null, onNavigate: vi.fn() }));
  });
  try {
    const original = '<style>html { color-scheme: light; background: #f6f6f8; } ::-webkit-scrollbar { width: 14px; }</style><h1>Original</h1>';
    await render(original, true);
    const frame = container.querySelector('iframe')!;
    const form = container.querySelector('form')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(form.getAttribute('action')).toBe('/api/html-preview');
    expect(form.method).toBe('post');
    expect(form.target).toBe(frame.name);
    expect(new FormData(form).get('repositoryId')).toBe('repo');
    expect(new FormData(form).get('path')).toBe('index.html');
    expect(new FormData(form).get('document')).toBe(original);
    expect(submit).toHaveBeenCalledTimes(1);
    await render('<h1>Edited</h1>', false);
    expect(submit).toHaveBeenCalledTimes(1);
    await render('<h1>Edited</h1>', true);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(container.querySelector('input')?.value).toBe('<h1>Edited</h1>');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('accepts links only from the active preview, rejects stale messages, and applies anchors after load without reposting the document', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onNavigate = vi.fn();
  const render = (document: string, anchor: { hash: string; id: string } | null = null, active = true) => act(async () => {
    root.render(createElement(HtmlPreviewFrame, { document, repositoryId: 'repo', path: 'docs/workflow.html', active, anchor, onNavigate }));
  });
  try {
    await render('<h1>Original</h1>');
    const frame = container.querySelector('iframe')!;
    const navigationId = () => container.querySelector<HTMLInputElement>('input[name=navigationId]')!.value;
    const firstId = navigationId();
    const send = (data: unknown, source: Window | null = frame.contentWindow, origin = 'null') => act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source, origin, data }));
    });
    const link = { type: 'opentig:html-link', navigationId: firstId, href: 'requirements.html#D-11' };
    await send(link, window);
    await send(link, frame.contentWindow, 'https://other.example');
    await send({ ...link, navigationId: 'old-document' });
    await send({ ...link, href: '../../escape.html' });
    expect(onNavigate).not.toHaveBeenCalled();
    await send(link);
    expect(onNavigate).toHaveBeenCalledWith('docs/requirements.html', '#D-11');
    await send({ ...link, href: 'manual.pdf' });
    expect(onNavigate).toHaveBeenLastCalledWith('docs/manual.pdf', '');
    await send({ ...link, href: 'https://example.com/guide' });
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/guide');

    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    await render('<h1>Original</h1>', { hash: '#D-11', id: 'anchor-1' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith({ type: 'opentig:html-anchor', navigationId: firstId, hash: '#D-11' }, '*');
    post.mockClear();
    await send({ type: 'opentig:html-ready', navigationId: firstId });
    expect(post).toHaveBeenCalledOnce();
    await render('<h1>Changed draft</h1>');
    expect(navigationId()).not.toBe(firstId);
    onNavigate.mockClear();
    await send(link);
    expect(onNavigate).not.toHaveBeenCalled();
    await render('<h1>Changed draft</h1>', null, false);
    await send({ ...link, navigationId: navigationId() });
    expect(onNavigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
