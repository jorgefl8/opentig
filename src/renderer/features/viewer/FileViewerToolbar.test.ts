// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FileViewerToolbarHostContext } from './file-viewer-toolbar-host';
import { FileViewerToolbar } from './FileViewerToolbar';

let root: Root;
let viewer: HTMLDivElement;
let bar: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  viewer = document.createElement('div');
  bar = document.createElement('div');
  document.body.append(bar, viewer);
  root = createRoot(viewer);
});

afterEach(() => {
  act(() => root.unmount());
  viewer.remove();
  bar.remove();
  vi.unstubAllGlobals();
});

function render(host: HTMLElement | null) {
  act(() => root.render(createElement(TooltipProvider, null,
    createElement(FileViewerToolbarHostContext.Provider, { value: host },
      createElement(FileViewerToolbar, { view: 'Preview', controls: 'Zoom', end: 'Save' })))));
}

it('stays in the viewer while the file tabs are not showing', () => {
  render(null);
  expect(viewer.querySelector('.file-viewer-toolbar')?.textContent).toBe('ZoomPreviewSave');
  expect(bar.children).toHaveLength(0);
});

it('joins the file tabs when they are showing', () => {
  render(bar);
  expect(bar.querySelector('.file-viewer-toolbar')?.textContent).toBe('ZoomPreviewSave');
  expect(viewer.querySelector('.file-viewer-toolbar')).toBeNull();
});
