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
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return null;
}
