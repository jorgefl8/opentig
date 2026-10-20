import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { IconChevronLeft, IconChevronRight, IconMinus, IconPlus } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import './pdf-file-viewer.css';

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_CANVAS_PIXELS = 16_000_000;

export function PdfFileViewer({ repositoryId, path, revision }: { repositoryId: string; path: string; revision: number }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [width, setWidth] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);

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
    setError(null);
    const task = getDocument({
      data: bytes.slice(), // PDF.js transfers this buffer to its worker.
      cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/',
    });
    void task.promise.then(document => {
      if (!active) return;
      setPdf(document);
      setPage(current => Math.min(current, document.numPages));
    }, reason => {
      if (active) setError(reason?.name === 'PasswordException'
        ? 'Password-protected PDFs are not supported in this preview.'
        : 'This PDF could not be opened. It may be damaged or unsupported.');
    });
    return () => { active = false; void task.destroy(); };
  }, [bytes]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = surface.current;
    if (!pdf || !element || !width) return;
    let active = true;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    setRendering(true);
    element.replaceChildren();
    scroller.current?.scrollTo(0, 0);
    void (async () => {
      try {
        const documentPage = await pdf.getPage(page);
        if (!active) return;
        const base = documentPage.getViewport({ scale: 1 });
        const nextScale = zoom === 'fit' ? Math.min(3, Math.max(0.1, (width - 32) / base.width)) : zoom;
        setScale(nextScale);
        const viewport = documentPage.getViewport({ scale: nextScale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const layer = document.createElement('div');
        layer.className = 'pdf-text-layer';
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        element.style.setProperty('--total-scale-factor', String(nextScale * documentPage.userUnit));
        element.append(canvas, layer);
        render = documentPage.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        text = new TextLayer({ textContentSource: documentPage.streamTextContent(), container: layer, viewport });
        await Promise.all([render.promise, text.render()]);
        if (active) setRendering(false);
      } catch {
        if (active) { setError('This PDF page could not be rendered.'); setRendering(false); }
      }
    })();
    return () => { active = false; render?.cancel(); text?.cancel(); element.replaceChildren(); };
  }, [pdf, page, zoom, width]);

  const changePage = (next: number) => {
    if (pdf && Number.isInteger(next)) setPage(Math.max(1, Math.min(pdf.numPages, next)));
  };
  return <div className="pdf-file-viewer">
    <div className="pdf-toolbar" role="toolbar" aria-label="PDF controls">
      <PdfButton label="Previous page" disabled={!pdf || page === 1} onClick={() => changePage(page - 1)}><IconChevronLeft /></PdfButton>
      <label className="pdf-page-number">
        <span className="sr-only">Page number</span>
        <input type="number" min={1} max={pdf?.numPages ?? 1} value={page} disabled={!pdf} onChange={event => changePage(Number(event.target.value))} />
        <span> / {pdf?.numPages ?? '—'}</span>
      </label>
      <PdfButton label="Next page" disabled={!pdf || page === pdf.numPages} onClick={() => changePage(page + 1)}><IconChevronRight /></PdfButton>
      <span className="pdf-toolbar-divider" />
      <PdfButton label="Zoom out" disabled={!pdf || scale <= 0.25} onClick={() => setZoom(Math.max(0.25, scale - 0.25))}><IconMinus /></PdfButton>
      <span className="pdf-zoom">{Math.round(scale * 100)}%</span>
      <PdfButton label="Zoom in" disabled={!pdf || scale >= 3} onClick={() => setZoom(Math.min(3, scale + 0.25))}><IconPlus /></PdfButton>
      <Button size="sm" variant="ghost" disabled={!pdf} aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit width</Button>
    </div>
    {(fetchError || error) && <div className="viewer-message text-destructive" role="alert">{fetchError || error}</div>}
    <div className="pdf-scroll" ref={scroller} tabIndex={0} aria-label={`PDF: ${path}`} style={fetchError || error ? { display: 'none' } : undefined}>
      {(!pdf || rendering) && <div className="pdf-loading" role="status">Loading PDF…</div>}
      <div ref={surface} className="pdf-page" role="document" aria-label={`Page ${page}`} aria-busy={rendering}
        style={{ visibility: pdf && !rendering ? 'visible' : 'hidden' } as CSSProperties} />
    </div>
  </div>;
}

function PdfButton({ label, children, ...props }: { label: string; children: React.ReactNode; disabled: boolean; onClick(): void }) {
  return <Tooltip><TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={label} {...props} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
