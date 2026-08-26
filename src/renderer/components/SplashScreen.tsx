import { OpenTigMark } from '@/components/OpenTigMark';

export function SplashScreen({ heading, detail }: { heading: string; detail?: string }) {
  return (
    <div className="splash" role="status">
      <OpenTigMark />
      <div className="splash-copy">
        <strong>{heading}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <div className="splash-mark" aria-hidden="true" />
    </div>
  );
}
