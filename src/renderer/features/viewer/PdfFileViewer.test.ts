// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PdfFileViewer } from './PdfFileViewer';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), getPage: vi.fn(), render: vi.fn(), cancel: vi.fn(), destroy: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
  TextLayer: class {
    constructor({ container }: { container: HTMLElement }) { container.textContent = 'Selectable PDF text'; }
    render() { return Promise.resolve(); }
    cancel() {}
  },
}));
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: () => void) {} observe() { this.callback(); } disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(566);
  HTMLElement.prototype.scrollTo = vi.fn();
  fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'application/pdf' } }));
  vi.stubGlobal('fetch', fetchMock);
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  mocks.getPage.mockResolvedValue({
    userUnit: 1, getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: mocks.render, streamTextContent: () => ({}),
  });
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage: mocks.getPage }), destroy: mocks.destroy });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function render(revision = 0) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(PdfFileViewer, { repositoryId: 'repo', path: 'docs/a b.pdf', revision }))));
}
async function click(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
}

it('renders every page at 100%, the whole page in view, in one scroll, navigates and zooms, retaining the page on unchanged refreshes', async () => {
  await render();
  expect(fetchMock).toHaveBeenCalledWith('/api/pdf/repo/docs/a%20b.pdf', expect.objectContaining({ credentials: 'include' }));
  expect(container.textContent).toContain('Selectable PDF text');
  expect(container.querySelectorAll('canvas')).toHaveLength(3);
  expect(container.querySelectorAll('[role=document]')).toHaveLength(3);
  // 100% fits the whole page: an 800 × 1066.7 px page in a 534 px tall viewport (566 minus padding).
  expect(mocks.render.mock.calls[0]![0].viewport.height).toBeCloseTo(534);
  expect(container.querySelector('button[aria-label="Show the whole page (100%)"]')?.textContent).toBe('100%');
  expect(container.querySelector('button[aria-label="Previous page"]')?.hasAttribute('disabled')).toBe(true);
  await click('Next page');
  expect(container.querySelector('input')?.value).toBe('2');
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled();
  await click('Zoom in');
  expect(mocks.render.mock.calls.at(-1)![0].viewport.height).toBeCloseTo(534 * 1.25);
  await render(1);
  expect(mocks.getDocument).toHaveBeenCalledTimes(1);
  expect(container.querySelector('input')?.value).toBe('2');
  await click('Next page');
  expect(container.querySelector('button[aria-label="Next page"]')?.hasAttribute('disabled')).toBe(true);
});

it('reports the size limit without trying to parse the response', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 413 }));
  await render();
  expect(container.querySelector('[role=alert]')?.textContent).toContain('32 MB');
  expect(mocks.getDocument).not.toHaveBeenCalled();
});

it('reports encrypted PDFs and destroys loading tasks on unmount', async () => {
  mocks.getDocument.mockImplementation(() => ({ promise: Promise.reject({ name: 'PasswordException' }), destroy: mocks.destroy }));
  await render();
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Password-protected');
  await act(async () => root.render(null));
  expect(mocks.destroy).toHaveBeenCalledTimes(1);
});
