import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { IconChevronLeft, IconChevronRight, IconMinus, IconPlus } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { FileViewerToolbar, FileViewerToolbarButton, FileViewerToolbarGroup } from './FileViewerToolbar';
import './pdf-file-viewer.css';

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_CANVAS_PIXELS = 16_000_000;
/** PDF points are 1/72 in; page boxes are measured in CSS pixels at physical size. */
const CSS_UNITS = 96 / 72;
/** Zoom is relative to showing a whole page: 100% fits the largest page inside the pane. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
/** Matches `.pdf-scroll` padding: the gap above the first page and around every page. */
const SCROLL_PADDING = 16;

interface PageSize { width: number; height: number }

export function PdfFileViewer({ repositoryId, path, revision }: { repositoryId: string; path: string; revision: number }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | 'fit'>(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageElements = useRef<(HTMLDivElement | null)[]>([]);
  // The page and the fraction of it at the top of the viewport, kept so zooming
  // and reloading a changed document stay on the same spot.
  const anchor = useRef({ index: 0, ratio: 0 });

  useEffect(() => {
    const controller = new AbortController();
    const url = `/api/pdf/${encodeURIComponent(repositoryId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 413 ? 'PDF preview is limited to 32 MB.'
          : response.status === 401 ? 'Sign in to preview this PDF.' : 'Could not load this PDF document.');
        if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('The server did not return a PDF document.');
        const data = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        setFetchError(null);
        // Background repository refreshes must not reset the page or restart the worker.
        setBytes(previous => previous?.length === data.length && previous.every((byte, index) => byte === data[index]) ? previous : data);
      } catch (reason) {
        if (!controller.signal.aborted) setFetchError(reason instanceof Error ? reason.message : 'Could not load PDF.');
      }
    })();
    return () => controller.abort();
  }, [repositoryId, path, revision]);

  useEffect(() => {
    if (!bytes) return;
    let active = true;
    setPdf(null);
    setSizes(null);
    setError(null);
    const task = getDocument({
      data: bytes.slice(), // PDF.js transfers this buffer to its worker.
      cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/',
    });
    void task.promise.then(async document => {
      // Every page gets its final box up front so the scrollbar and page
      // positions stay stable while pages render lazily.
      const pages = await Promise.all(Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)));
      if (!active) return;
      setSizes(pages.map(documentPage => {
        const viewport = documentPage.getViewport({ scale: CSS_UNITS });
        return { width: viewport.width, height: viewport.height };
      }));
      setPdf(document);
      setPage(current => Math.min(current, document.numPages));
    }).catch(reason => {
      if (active) setError(reason?.name === 'PasswordException'
        ? 'Password-protected PDFs are not supported in this preview.'
        : 'This PDF could not be opened. It may be damaged or unsupported.');
    });
    return () => { active = false; void task.destroy(); };
  }, [bytes]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const widest = sizes ? Math.max(...sizes.map(size => size.width)) : 0;
  const tallest = sizes ? Math.max(...sizes.map(size => size.height)) : 0;
  const widthFit = widest && viewport.width ? Math.max(0.05, (viewport.width - SCROLL_PADDING * 2) / widest) : 1;
  const pageFit = tallest && viewport.height > SCROLL_PADDING * 2
    ? Math.min(widthFit, (viewport.height - SCROLL_PADDING * 2) / tallest)
    : widthFit;
  // The zoom shown to the user, relative to the whole-page fit.
  const relativeZoom = zoom === 'fit' ? widthFit / pageFit : zoom;
  const scale = relativeZoom * pageFit;

  const updateCurrentPage = useCallback(() => {
    const element = scroller.current;
    const pages = pageElements.current;
    if (!element || !pages.length) return;
    const probe = element.scrollTop + element.clientHeight * 0.3;
    let index = 0;
    for (let candidate = 0; candidate < pages.length; candidate += 1) {
      const pageElement = pages[candidate];
      if (pageElement && pageElement.offsetTop <= probe) index = candidate;
      else if (pageElement) break;
    }
    const current = pages[index];
    if (current) anchor.current = { index, ratio: (element.scrollTop - current.offsetTop + SCROLL_PADDING) / Math.max(1, current.offsetHeight) };
    setPage(index + 1);
  }, []);

  // Pages resize when the zoom changes or a changed document loads; keep the
  // same part of the same page at the top instead of jumping elsewhere.
  useLayoutEffect(() => {
    const element = scroller.current;
    const target = pageElements.current[anchor.current.index];
    if (!element || !target) return;
    element.scrollTop = Math.max(0, target.offsetTop - SCROLL_PADDING + anchor.current.ratio * target.offsetHeight);
  }, [scale, sizes]);

  const goToPage = (next: number) => {
    if (!pdf || !Number.isInteger(next)) return;
    const index = Math.max(1, Math.min(pdf.numPages, next)) - 1;
    const target = pageElements.current[index];
    anchor.current = { index, ratio: 0 };
    setPage(index + 1);
    if (target) scroller.current?.scrollTo({ top: Math.max(0, target.offsetTop - SCROLL_PADDING) });
  };
  const zoomIn = () => setZoom(Math.min(MAX_ZOOM, (Math.floor(relativeZoom / ZOOM_STEP + 1e-6) + 1) * ZOOM_STEP));
  const zoomOut = () => setZoom(Math.max(MIN_ZOOM, (Math.ceil(relativeZoom / ZOOM_STEP - 1e-6) - 1) * ZOOM_STEP));

  return <div className="pdf-file-viewer">
    <FileViewerToolbar
      start={
        <FileViewerToolbarGroup label="Page">
          <FileViewerToolbarButton label="Previous page" disabled={!pdf || page === 1} onClick={() => goToPage(page - 1)}><IconChevronLeft /></FileViewerToolbarButton>
          <label className="pdf-page-number">
            <span className="sr-only">Page number</span>
            <input type="number" min={1} max={pdf?.numPages ?? 1} value={page} disabled={!pdf} onChange={event => goToPage(Number(event.target.value))} />
            <span>/ {pdf?.numPages ?? '—'}</span>
          </label>
          <FileViewerToolbarButton label="Next page" disabled={!pdf || page === pdf.numPages} onClick={() => goToPage(page + 1)}><IconChevronRight /></FileViewerToolbarButton>
        </FileViewerToolbarGroup>
      }
      controls={
        <FileViewerToolbarGroup label="Zoom">
          <FileViewerToolbarButton label="Zoom out" disabled={!pdf || relativeZoom <= MIN_ZOOM} onClick={zoomOut}><IconMinus /></FileViewerToolbarButton>
          <Button type="button" variant="ghost" size="sm" className="file-viewer-toolbar-value" aria-label="Show the whole page (100%)" disabled={!pdf} onClick={() => setZoom(1)}>
            {Math.round(relativeZoom * 100)}%
          </Button>
          <FileViewerToolbarButton label="Zoom in" disabled={!pdf || relativeZoom >= MAX_ZOOM} onClick={zoomIn}><IconPlus /></FileViewerToolbarButton>
          <Button type="button" size="sm" variant="ghost" disabled={!pdf} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit width</Button>
        </FileViewerToolbarGroup>
      }
    />
    {(fetchError || error) && <div className="viewer-message text-destructive" role="alert">{fetchError || error}</div>}
    <div className="pdf-scroll" ref={scroller} tabIndex={0} aria-label={`PDF: ${path}`} onScroll={updateCurrentPage}
      style={fetchError || error ? { display: 'none' } : undefined}>
      {!pdf || !sizes ? <div className="pdf-loading" role="status">Loading PDF…</div> : (
        <div className="pdf-pages">
          {sizes.map((size, index) => (
            <PdfPage
              key={index}
              ref={element => { pageElements.current[index] = element; }}
              pdf={pdf}
              number={index + 1}
              size={size}
              scale={scale}
              root={scroller}
            />
          ))}
        </div>
      )}
    </div>
  </div>;
}

/** One page box at its final size; it renders only while near the viewport and frees its canvas once it scrolls away. */
function PdfPage({ ref, pdf, number, size, scale, root }: {
  ref(element: HTMLDivElement | null): void;
  pdf: PDFDocumentProxy;
  number: number;
  size: PageSize;
  scale: number;
  root: RefObject<HTMLDivElement | null>;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const setElement = useCallback((node: HTMLDivElement | null) => { element.current = node; ref(node); }, [ref]);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => setNear(entries.some(entry => entry.isIntersecting)), {
      root: root.current, rootMargin: '100% 0px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (!near) { node.replaceChildren(); return; }
    let active = true;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    void (async () => {
      try {
        const documentPage = await pdf.getPage(number);
        if (!active) return;
        const viewport = documentPage.getViewport({ scale: scale * CSS_UNITS });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        const layer = document.createElement('div');
        layer.className = 'pdf-text-layer';
        render = documentPage.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        text = new TextLayer({ textContentSource: documentPage.streamTextContent(), container: layer, viewport });
        await render.promise;
        if (!active) return;
        // The previous rendering stays visible, stretched, until this one is ready.
        node.style.setProperty('--total-scale-factor', String(scale * CSS_UNITS * documentPage.userUnit));
        node.replaceChildren(canvas, layer);
        await text.render();
        if (active) setFailed(false);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; render?.cancel(); text?.cancel(); };
  }, [near, number, pdf, scale]);

  return (
    <div
      ref={setElement}
      className="pdf-page"
      role="document"
      aria-label={`Page ${number}`}
      data-failed={failed || undefined}
      style={{ width: size.width * scale, height: size.height * scale } as CSSProperties}
    />
  );
}
