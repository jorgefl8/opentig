import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

/** --motion-med and --ease-out from the stylesheet, so expanding content moves like the rest of the app. */
const REVEAL_TRANSITION = { duration: 0.2, ease: [0.32, 0.72, 0, 1] as const };

/**
 * Expands and collapses content by animating its height and opacity.
 * `follow` keeps animating when the open content changes size, such as a list that finishes loading.
 * `animate={false}` shows and hides immediately, for content too large to animate smoothly.
 * Reduced-motion preferences always show and hide immediately.
 */
export function Reveal({ open, children, className, style, follow = false, animate = true }: {
  open: boolean;
  children: ReactNode;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  follow?: boolean;
  animate?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const instant = Boolean(reduceMotion) || !animate;
  return (
    <AnimatePresence initial={false}>
      {open && <RevealBody key="reveal" instant={instant} follow={follow} className={className} style={style}>{children}</RevealBody>}
    </AnimatePresence>
  );
}

function RevealBody({ instant, follow, className, style, children }: {
  instant: boolean;
  follow: boolean;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  // Clip only while moving, so focus rings and overflowing content show once it has settled.
  const [moving, setMoving] = useState(!instant);

  useLayoutEffect(() => {
    const element = content.current;
    if (!follow || instant || !element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [follow, instant]);

  return (
    <motion.div
      initial={instant ? false : { height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={instant ? { height: 0, opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
      transition={instant ? { duration: 0 } : REVEAL_TRANSITION}
      onAnimationStart={() => { if (!instant) setMoving(true); }}
      onAnimationComplete={() => setMoving(false)}
      style={{ overflow: moving ? 'hidden' : undefined }}
    >
      <div ref={content} className={className} style={style}>{children}</div>
    </motion.div>
  );
}
