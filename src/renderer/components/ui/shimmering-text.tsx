import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface ShimmeringTextProps {
  /** Text to display with shimmer effect */
  text: string;
  /** Animation duration in seconds */
  duration?: number;
  /** Pause duration between repeats in seconds */
  repeatDelay?: number;
  /** Shimmer spread multiplier */
  spread?: number;
  /** Custom className */
  className?: string;
  /** Base text color */
  color?: string;
  /** Shimmer gradient color */
  shimmerColor?: string;
}

/**
 * Dependency-free port of idecloud-idp's ShimmeringText: each character cycles
 * between a base and a highlight color with a per-character stagger. Reduced
 * motion is honored from CSS (`.shimmer-text`), not JavaScript.
 */
export function ShimmeringText({ text, duration = 1.35, repeatDelay = 0.25, spread = 1.6, className, color, shimmerColor }: ShimmeringTextProps) {
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let inViewport = typeof IntersectionObserver === 'undefined';
    const reconcile = () => element.style.setProperty('--shimmer-text-play-state', inViewport && document.visibilityState !== 'hidden' ? 'running' : 'paused');
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.target === element) inViewport = entry.isIntersecting;
      reconcile();
    });
    observer?.observe(element);
    document.addEventListener('visibilitychange', reconcile);
    reconcile();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, []);
  const characters = useMemo(() => Array.from(text), [text]);
  const cycleDuration = duration + repeatDelay;
  const stagger = characters.length > 1 ? (duration * spread) / characters.length : 0;
  const containerStyle = {
    color: color ?? 'var(--muted-foreground)',
    '--shimmer-text-base': color ?? 'var(--muted-foreground)',
    '--shimmer-text-highlight': shimmerColor ?? 'var(--foreground)',
    '--shimmer-text-play-state': 'paused',
  } as CSSProperties;

  return (
    <span ref={container} className={cn('shimmer-text inline-block whitespace-pre', className)} style={containerStyle}>
      {characters.map((character, index) => (
        <span
          key={`${character}-${index}`}
          className="inline-block whitespace-pre"
          style={{
            animationName: 'opentig-shimmer-text',
            animationDuration: `${cycleDuration}s`,
            animationTimingFunction: 'ease-in-out',
            animationDelay: `${index * stagger}s`,
            animationIterationCount: 'infinite',
            animationFillMode: 'both',
            animationPlayState: 'var(--shimmer-text-play-state)',
          }}
        >
          {character}
        </span>
      ))}
    </span>
  );
}
