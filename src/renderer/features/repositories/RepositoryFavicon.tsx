import { useEffect, useState } from 'react';

export function RepositoryFaviconImage({ src }: { src: string | undefined }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return null;
  return <img className="repo-select-favicon" src={src} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}
