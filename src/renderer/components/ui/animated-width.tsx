import { useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * An inline box that glides to its new width when what it shows changes, such as a button going
 * from "Merge" to "Merging…". Only a change of `contentKey` animates, so typing or resizing never does.
 */
export function AnimatedWidth({ contentKey, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { contentKey: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const lastWidth = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    // Sizes are set and cleared without a transition: the root allows animating to `auto`, which would
    // otherwise make every clear an animation of its own and leave the row a frame behind.
    const settle = () => {
      element.style.transition = 'none';
      element.style.width = '';
      element.style.overflow = '';
      void element.offsetWidth;
      element.style.transition = '';
    };
    settle();
    const to = element.getBoundingClientRect().width;
    const from = lastWidth.current;
    lastWidth.current = to;
    if (from === null || Math.abs(from - to) < 0.5 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Clipped only while it moves, so a focus ring isn't cut off at rest.
    element.style.transition = 'none';
    element.style.overflow = 'hidden';
    element.style.width = `${from}px`;
    void element.offsetWidth;
    element.style.transition = '';
    element.style.width = `${to}px`;
    const release = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'width') settle();
    };
    element.addEventListener('transitionend', release);
    return () => element.removeEventListener('transitionend', release);
  }, [contentKey]);
  return <span ref={box} className={cn('animated-width', className)} {...props}>{children}</span>;
}
