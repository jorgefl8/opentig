import { useEffect, useState, type ReactNode } from 'react';

export function RepositoryFaviconImage({ src, fallback = null }: { src: string | undefined; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return fallback;
  return <img className="repo-select-favicon" src={src} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}
