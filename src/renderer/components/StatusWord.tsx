import type { ReactNode } from 'react';

export type StatusTone = 'ready' | 'attention' | 'danger' | 'neutral';

/** A status as a dot and a word. Colour goes on the dot, so a list of them stays quiet. */
export function StatusWord({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className="status-word"><span className={`status-dot tone-${tone}`} aria-hidden="true" />{children}</span>;
}
