import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import type { FileResult, ImageFileResult, ThemePreference, WriteFileResult } from '@shared/contracts';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ViewerTabs, ViewerTabsList, ViewerTabsPanel } from '@/components/ui/viewer-tabs';
import { FileSaveControls, SourceCodeEditor } from './EditableFileViewer';
import { MAX_IMAGE_ZOOM, type ImageSizingMode, zoomIn, zoomOut } from './image-viewer-state';
import { useEditableFileDraft } from './useEditableFileDraft';
import './image-viewer.css';

interface ImageFileViewerProps {
  image: ImageFileResult;
}

interface SvgFileViewerProps {
  file: FileResult;
  /** The draft App is holding for this path, or the file's own content. */
  initialContent: string;
  themeType: ThemePreference;
  wrapLines: boolean;
  readOnly: boolean;
  onDirtyChange(dirty: boolean): void;
  onDraftChange(content: string): void;
  onSave(path: string, content: string, expectedContent: string): Promise<WriteFileResult>;
}

interface Dimensions {
  width: number;
  height: number;
}

const SVG_SAVE_MESSAGES = {
  conflictTitle: 'SVG was changed outside JustGit',
  successTitle: 'SVG saved',
  errorTitle: 'Could not save SVG',
};

export function ImageFileViewer({ image }: ImageFileViewerProps) {
  if (image.status === 'unsupported') {
    return (
      <ImageViewerMessage
        title="Image format is not supported"
        detail={`${image.path} · ${formatBytes(image.size)}`}
      />
    );
  }
  if (image.status === 'too-large') {
    return (
      <ImageViewerMessage
        title="Image is too large to preview"
        detail={`${image.path} · ${formatBytes(image.size)} · limit ${formatBytes(image.limit)}`}
      />
    );
  }

  return (
    <RasterImageReady
      path={image.path}
      mimeType={image.mimeType}
      size={image.size}
      data={image.data}
    />
  );
}

function RasterImageReady({ path, mimeType, size, data }: {
  path: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
}) {
  const objectUrl = useObjectUrl(data, mimeType);
  return (
    <ImagePreviewWorkspace
      objectUrl={objectUrl}
      path={path}
      size={size}
    />
  );
}

export function SvgFileViewer({ file, initialContent, themeType, wrapLines, readOnly, onDirtyChange, onDraftChange, onSave }: SvgFileViewerProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const { draft, updateDraft, dirty, saving, save } = useEditableFileDraft({
    file, initialContent, readOnly, messages: SVG_SAVE_MESSAGES, onDirtyChange, onDraftChange, onSave,
  });
  const objectUrl = useObjectUrl(draft, 'image/svg+xml');

  useEffect(() => {
    setTab('preview');
  }, [file.path]);

  const tabs = (
    <ViewerTabsList
      label="SVG view"
      className="file-viewer-tabs image-viewer-tabs"
      items={[
        { value: 'preview', label: 'Preview' },
        { value: 'code', label: <>Code {dirty && <span className="image-unsaved-dot" aria-label="Unsaved changes" />}</> },
      ]}
    />
  );
  const saveControls = <FileSaveControls dirty={dirty} saving={saving} readOnly={readOnly} onSave={() => void save()} />;

  return (
    <ViewerTabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="svg-file-viewer">
      <ViewerTabsPanel value="preview" className="svg-file-panel">
        <ImagePreviewWorkspace
          objectUrl={objectUrl}
          path={file.path}
          size={new TextEncoder().encode(draft).byteLength}
          toolbarStart={tabs}
          toolbarEnd={saveControls}
        />
      </ViewerTabsPanel>
      <ViewerTabsPanel value="code" className="svg-file-panel">
          <div className="file-viewer-pill svg-file-toolbar">{tabs}{saveControls}</div>
          <div className="svg-code-view">
            <SourceCodeEditor
              path={file.path}
              cacheKey={file.path}
              value={draft}
              themeType={themeType}
              wrapLines={wrapLines}
              readOnly={readOnly || saving}
              onChange={updateDraft}
              />
          </div>
      </ViewerTabsPanel>
    </ViewerTabs>
  );
}

function ImagePreviewWorkspace({ objectUrl, path, size, toolbarStart, toolbarEnd }: {
  objectUrl: string | null;
  path: string;
  size: number;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
}) {
  const [mode, setMode] = useState<ImageSizingMode>('fit');
  const [zoom, setZoom] = useState(1);
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [decodeError, setDecodeError] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDimensions(null);
    setDecodeError(false);
  }, [objectUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let accumulatedDelta = 0;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? 100
          : 1;
      accumulatedDelta += event.deltaY * multiplier;
      if (Math.abs(accumulatedDelta) < 24) return;
      const zoomingIn = accumulatedDelta < 0;
      accumulatedDelta = 0;
      setMode('actual');
      setZoom((current) => zoomingIn ? zoomIn(current) : zoomOut(current));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const actualWidth = dimensions ? dimensions.width * zoom : undefined;
  const actualHeight = dimensions ? dimensions.height * zoom : undefined;
  const details = [formatBytes(size), dimensions ? `${dimensions.width} × ${dimensions.height}` : null].filter(Boolean).join(' · ');

  const changeZoom = (direction: 'in' | 'out') => {
    setMode('actual');
    setZoom((current) => direction === 'in' ? zoomIn(current) : zoomOut(current));
  };

  return (
    <div className="image-preview-workspace">
      <div className="file-viewer-pill image-preview-toolbar">
        {toolbarStart}
        <span className="image-file-details">{details}</span>
        <div className="image-sizing-toggle" role="group" aria-label="Image size">
          <Button type="button" size="xs" variant={mode === 'fit' ? 'secondary' : 'ghost'} aria-pressed={mode === 'fit'} onClick={() => setMode('fit')}>Fit</Button>
          <Button type="button" size="xs" variant={mode === 'actual' && zoom === 1 ? 'secondary' : 'ghost'} aria-pressed={mode === 'actual' && zoom === 1} onClick={() => { setMode('actual'); setZoom(1); }}>1:1</Button>
        </div>
        <div className="image-zoom-controls">
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Zoom out" onClick={() => changeZoom('out')} />}>
              <IconZoomOut />
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <Button type="button" variant="ghost" size="xs" className="image-zoom-value" aria-label="Reset zoom to 100%" onClick={() => { setMode('actual'); setZoom(1); }}>
            {Math.round(zoom * 100)}%
          </Button>
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Zoom in" onClick={() => changeZoom('in')} />}>
              <IconZoomIn />
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
        </div>
        {toolbarEnd}
      </div>
      <div
        ref={canvasRef}
        className="image-preview-canvas"
        data-sizing={mode}
        data-zoom-limit={zoom >= MAX_IMAGE_ZOOM ? 'max' : 'normal'}
        tabIndex={0}
        aria-label={`Image preview for ${path}`}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') changeZoom('in');
          else if (event.key === '-') changeZoom('out');
          else if (event.key === '0') { setMode('actual'); setZoom(1); }
          else if (event.key.toLowerCase() === 'f') setMode('fit');
          else return;
          event.preventDefault();
        }}
      >
        {!objectUrl ? (
          <span className="image-preview-loading">Loading image…</span>
        ) : decodeError ? (
          <ImageViewerMessage title="Could not decode this image" detail={path} />
        ) : (
          <img
            src={objectUrl}
            alt={fileName(path)}
            draggable={false}
            style={mode === 'actual' && actualWidth && actualHeight
              ? { width: actualWidth, height: actualHeight, maxWidth: 'none', maxHeight: 'none' }
              : undefined}
            onLoad={(event) => {
              setDecodeError(false);
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            onError={() => setDecodeError(true)}
          />
        )}
      </div>
    </div>
  );
}

function ImageViewerMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="image-viewer-message">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function useObjectUrl(source: Uint8Array | string, mimeType: string): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    const part = typeof source === 'string' ? source : new Uint8Array(source);
    const next = URL.createObjectURL(new Blob([part], { type: mimeType }));
    setObjectUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setObjectUrl((current) => current === next ? null : current);
    };
  }, [mimeType, source]);
  return objectUrl;
}

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
