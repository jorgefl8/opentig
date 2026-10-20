import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import './file-viewer-toolbar.css';

/**
 * The fixed header shared by every document viewer. It matches the sidebar tab
 * row's height, centers the view switch and the viewer's own controls, and
 * keeps Save at the end, so nothing covers the document and every file type
 * puts its controls in the same place.
 */
export function FileViewerToolbar({ start, controls, end }: { start?: ReactNode; controls?: ReactNode; end?: ReactNode }) {
  return (
    <div className="file-viewer-toolbar">
      <div className="file-viewer-toolbar-center">
        <div className="file-viewer-toolbar-start">{start}</div>
        <div className="file-viewer-toolbar-controls">{controls}</div>
      </div>
      <div className="file-viewer-toolbar-end">{end}</div>
    </div>
  );
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
      <TooltipTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
