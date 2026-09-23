import { useEffect, useState } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { isDevProfile } from '@/lib/app-identity';
import { writeClipboardText } from '@/lib/browser-capabilities';

export function PairingCommand() {
  const command = isDevProfile ? 'npm run pair:web:dev' : 'opentig pair';
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status !== 'copied') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copy = async () => {
    try {
      await writeClipboardText(command);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
        <code className="min-w-0 flex-1 basis-44 select-text break-words text-sm">{command}</code>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {status === 'copied' ? <IconCheck /> : <IconCopy />}
          <span aria-live="polite">{status === 'copied' ? 'Copied' : 'Copy command'}</span>
        </Button>
      </div>
      {status === 'failed' && <p className="mt-2 text-sm text-destructive" role="alert">Could not copy. Select and copy the command manually.</p>}
    </div>
  );
}
