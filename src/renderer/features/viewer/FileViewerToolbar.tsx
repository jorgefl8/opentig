import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FileViewerToolbarHostContext } from './file-viewer-toolbar-host';
import './file-viewer-toolbar.css';

/**
 * The tools shared by every document viewer: its own controls, then the view
 * switch, then Save, so nothing covers the document and every file type puts them
 * in the same place. They join the file tabs when those are showing, and take a
 * thin row of their own when they aren't.
 */
export function FileViewerToolbar({ view, controls, end }: { view?: ReactNode; controls?: ReactNode; end?: ReactNode }) {
  const host = useContext(FileViewerToolbarHostContext);
  const toolbar = (
    <div className="file-viewer-toolbar">
      <div className="file-viewer-toolbar-controls">{controls}</div>
      <div className="file-viewer-toolbar-view">{view}</div>
      <div className="file-viewer-toolbar-end">{end}</div>
    </div>
  );
  return host ? createPortal(toolbar, host) : toolbar;
}

export function FileViewerToolbarGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="file-viewer-toolbar-group" role="group" aria-label={label}>{children}</div>;
}

export function FileViewerToolbarButton({ label, pressed, disabled, onClick, children }: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" size="icon-xs" variant="ghost" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
