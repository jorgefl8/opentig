import type { ReactNode } from 'react';

/** The most characters of a path a notice shows; longer ones keep their start and their end. */
const MAX_SHOWN = 48;

/**
 * A path in a notice, set as code and shortened, so text from an address can
 * only ever read as the path that was not found, never as a message of its own.
 */
export function noticePath(path: string, after: string): ReactNode {
  const shown = path.length <= MAX_SHOWN ? path : `${path.slice(0, 16)}…${path.slice(-(MAX_SHOWN - 17))}`;
  return <><code className="notice-path">{shown}</code> {after}</>;
}
