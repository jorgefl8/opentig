import { useCallback, useEffect, useState } from 'react';

type MermaidTheme = 'default' | 'dark';

let nextDiagramId = 0;

function currentTheme(): MermaidTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

export function useMermaid(container: React.RefObject<HTMLElement | null>, active: boolean, html: string): void {
  const [theme, setTheme] = useState<MermaidTheme>(currentTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const render = useCallback(async (cancelled: () => boolean) => {
    if (!active || !container.current) return;
    const diagrams = Array.from(container.current.querySelectorAll<HTMLElement>('.mermaid'));
    if (diagrams.length === 0) return;

    try {
      const { default: mermaid } = await import('mermaid');
      if (cancelled() || !container.current) return;
      mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });

      for (const diagram of diagrams) {
        const encoded = diagram.dataset.mermaidSource;
        if (!encoded) continue;
        diagram.removeAttribute('data-mermaid-error');

        try {
          const source = decodeURIComponent(encoded);
          const id = `mermaid-diagram-${nextDiagramId++}`;
          const { svg, bindFunctions } = await mermaid.render(id, source, diagram);
          if (cancelled() || !diagram.isConnected) return;
          diagram.innerHTML = svg;
          diagram.dataset.processed = 'true';
          bindFunctions?.(diagram);
        } catch {
          if (!cancelled() && diagram.isConnected) {
            diagram.textContent = decodeURIComponent(encoded);
            diagram.dataset.mermaidError = 'Could not render diagram';
          }
        }
      }
    } catch {
      for (const diagram of diagrams) {
        if (!cancelled() && diagram.isConnected) diagram.dataset.mermaidError = 'Could not load Mermaid';
      }
    }
  }, [active, container, theme]);

  useEffect(() => {
    let cancelled = false;
    void render(() => cancelled);
    return () => { cancelled = true; };
  }, [html, render]);
}
