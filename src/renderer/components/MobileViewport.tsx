import { useEffect } from 'react';

export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      // Pinch zoom must remain free to pan; only follow the software keyboard.
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      document.documentElement.style.setProperty('--mobile-viewport-height', `${viewport.height}px`);
      document.documentElement.style.setProperty('--mobile-viewport-top', `${viewport.offsetTop}px`);
      const element = document.activeElement;
      const editing = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        || (element instanceof HTMLElement && element.isContentEditable);
      document.documentElement.dataset.mobileKeyboard = String(editing && viewport.height < document.documentElement.clientHeight - 100);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      delete document.documentElement.dataset.mobileKeyboard;
    };
  }, []);
  return null;
}
