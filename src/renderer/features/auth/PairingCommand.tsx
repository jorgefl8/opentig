import { useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { isDevProfile } from '@/lib/app-identity';

export function PairingCommand({ recovery = false }: { recovery?: boolean }) {
  const command = recovery ? (isDevProfile ? 'node packages/server/dist/dev.mjs reset-access' : 'opentig reset-access') : isDevProfile ? 'npm run pair:web:dev' : 'opentig pair';
  const [failed, setFailed] = useState(false);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <code className="min-w-0 select-text break-words text-sm">{command}</code>
        <CopyButton value={command} label={recovery ? 'Copy recovery command' : 'Copy command'} onCopied={() => setFailed(false)} onError={() => setFailed(true)} />
      </div>
      {failed && <p className="mt-2 text-sm text-destructive" role="alert">Could not copy. Select and copy the command manually.</p>}
    </div>
  );
}
