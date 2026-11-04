import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Tells whether any child of the returned element is cut off, so the full text
 * is offered as a hint only when part of it is hidden instead of covering the
 * content below on every hover. Pass a key that changes with the text.
 */
export function useTruncatedText(contentKey: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setTruncated([...element.children].some((child) => child.scrollWidth > child.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [contentKey]);
  return [ref, truncated] as const;
}
