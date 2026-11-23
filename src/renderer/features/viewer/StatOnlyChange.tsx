import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * What an unstaged change shows when Git lists the file as changed but its content is the staged
 * version: only the size or times Git keeps for the file differ on disk. Clearing it stages nothing.
 */
export function StatOnlyChange({ path, readOnly, onClear }: { path: string; readOnly: boolean; onClear: (path: string) => Promise<void> }) {
  const [clearing, setClearing] = useState(false);
  const clear = async () => {
    setClearing(true);
    try { await onClear(path); } finally { setClearing(false); }
  };
  return (
    <div className="viewer-message flex-col gap-3 px-4 text-center">
      <p className="max-w-[460px] text-foreground">Git lists this file as changed, but its content matches the last staged version.</p>
      <p className="max-w-[460px]">Only something Git checks on disk changed, such as its line endings, size or timestamps. Clearing it updates what Git records about the file and stages nothing.</p>
      <Button variant="outline" size="sm" disabled={readOnly || clearing} onClick={() => void clear()}>
        {clearing && <Spinner />} Clear from Changes
      </Button>
    </div>
  );
}
