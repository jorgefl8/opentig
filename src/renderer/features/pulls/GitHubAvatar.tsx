import { useState } from 'react';
import { IconUserCircle } from '@tabler/icons-react';

interface GitHubAvatarProps {
  src: string | null;
  className: string;
}

export function GitHubAvatar({ src, className }: GitHubAvatarProps) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={className} aria-hidden="true">
      {src && !failed
        ? <img src={src} alt="" onError={() => setFailed(true)} />
        : <IconUserCircle />}
    </span>
  );
}
