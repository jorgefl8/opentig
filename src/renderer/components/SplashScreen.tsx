import { OpenTigMark } from '@/components/OpenTigMark';
import { ShimmeringText } from '@/components/ui/shimmering-text';

export function SplashScreen({ heading, detail, busy = true }: { heading: string; detail?: string; busy?: boolean }) {
  return (
    <div className="splash">
      <OpenTigMark />
      <div className="splash-copy">
        <strong>{heading}</strong>
        <span role="status" aria-live="polite">{detail ? (busy ? <ShimmeringText text={detail} /> : detail) : ''}</span>
      </div>
      {busy ? (
        // Drawn like the boot shell's ring in index.html, which this replaces in place.
        <svg className="splash-mark" viewBox="0 0 28 28" fill="none" strokeWidth="3" aria-hidden="true">
          <circle className="splash-mark-track" cx="14" cy="14" r="12.5" />
          <g className="splash-mark-arc"><path d="M5.16 5.16A12.5 12.5 0 0 1 22.84 5.16" /></g>
        </svg>
      ) : null}
    </div>
  );
}
