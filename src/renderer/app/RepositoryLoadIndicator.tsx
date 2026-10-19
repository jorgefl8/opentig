import { useEffect, useRef, useState } from 'react';
import { IconLoader4 } from '@tabler/icons-react';

export type RepositoryLoadPhase = 'opening' | 'loading';

/** Thin progress line under the toolbar, a notice for slow repositories, and a screen reader status. */
export function RepositoryLoadIndicator({ phase, visible, slow, name }: {
  phase: RepositoryLoadPhase | null;
  visible: boolean;
  slow: boolean;
  name: string;
}) {
  const [finishing, setFinishing] = useState(false);
  const shown = useRef(false);
  useEffect(() => {
    if (visible) { shown.current = true; return; }
    if (!shown.current) return;
    shown.current = false;
    // Complete the line briefly so the end of a visible load is noticeable.
    setFinishing(true);
    const timer = window.setTimeout(() => setFinishing(false), 400);
    return () => window.clearTimeout(timer);
  }, [visible]);
  return <>
    {(visible || finishing) && <div className="repository-load-progress" data-state={visible ? 'running' : 'done'} aria-hidden="true"><span /></div>}
    {slow && (
      <div className="repository-load-slow" role="status">
        <IconLoader4 className="animate-spin" aria-hidden="true" />
        <span>Still opening <strong>{name}</strong>…</span>
        <small>Large repositories can take a moment.</small>
      </div>
    )}
    <span className="sr-only" role="status">{phase ? `Opening ${name}…` : `${name} opened`}</span>
  </>;
}
