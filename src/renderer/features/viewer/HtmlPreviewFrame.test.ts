// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HtmlPreviewFrame } from './HtmlPreviewFrame';

it('keeps the installed-app preview sandboxed and posts updated drafts only while active', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (document: string, active: boolean) => act(async () => {
    root.render(createElement(HtmlPreviewFrame, { document, path: 'index.html', active }));
  });
  try {
    await render('<h1>Original</h1>', true);
    const frame = container.querySelector('iframe')!;
    const form = container.querySelector('form')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(form.getAttribute('action')).toBe('/api/html-preview');
    expect(form.method).toBe('post');
    expect(form.target).toBe(frame.name);
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
