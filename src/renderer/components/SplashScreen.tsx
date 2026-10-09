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
      {busy ? <div className="splash-mark" aria-hidden="true" /> : null}
    </div>
  );
}
