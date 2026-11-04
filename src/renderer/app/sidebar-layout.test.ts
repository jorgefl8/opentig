import { describe, expect, it } from 'vitest';
import { ariaKeyShortcut, clampSidebarWidth, resolveSidebarDrag } from './sidebar-layout';

describe('sidebar drag', () => {
  it('resizes within the allowed widths', () => {
    expect(resolveSidebarDrag(400, 120, 44)).toEqual({ width: 520, collapse: false, previewWidth: 520 });
    expect(resolveSidebarDrag(400, 900, 44)).toEqual({ width: 680, collapse: false, previewWidth: 680 });
    expect(resolveSidebarDrag(400, -150, 44)).toEqual({ width: 300, collapse: false, previewWidth: 300 });
  });

  it('collapses past the threshold and keeps the width to reopen at', () => {
    expect(resolveSidebarDrag(460, -300, 44)).toEqual({ width: 460, collapse: true, previewWidth: 160 });
    expect(resolveSidebarDrag(400, -600, 44)).toEqual({ width: 400, collapse: true, previewWidth: 44 });
  });

  it('rounds fractional pointer positions and spells shortcuts for assistive tech', () => {
    expect(clampSidebarWidth(412.6)).toBe(413);
    expect(ariaKeyShortcut('Ctrl+Shift+B')).toBe('Control+Shift+B');
  });
});
