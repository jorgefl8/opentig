import { IconX } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { MobileSheet } from '@/components/MobileSheet';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import type { FileSession } from './open-files-model';

/** Every open file on a phone: switch to one, close it, and see which are unsaved or missing. */
export function OpenFilesSheet({ open, onOpenChange, session, onOpenFile, onCloseFile }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  session: FileSession;
  onOpenFile(path: string): void;
  onCloseFile(path: string): void;
}) {
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Open files">
      {session.tabs.map((tab) => <div className={`mobile-open-file ${session.activePath === tab.path ? 'active' : ''}`} key={tab.path}>
        <button className="mobile-sheet-action" aria-current={session.activePath === tab.path ? 'true' : undefined} onClick={() => { onOpenChange(false); onOpenFile(tab.path); }}>
          <img src={getVsCodeFileIconUrl(tab.path)} alt="" draggable={false} /><span><strong>{tab.path.split('/').pop()}</strong><small>{tab.path}{tab.missing ? ' · Missing' : tab.dirty ? ' · Unsaved' : session.previewPath === tab.path ? ' · Preview' : ''}</small></span>
        </button>
        <Button variant="ghost" size="icon" aria-label={`Close ${tab.path}`} onClick={() => onCloseFile(tab.path)}><IconX /></Button>
      </div>)}
      {session.tabs.length === 0 && <p className="mobile-list-message">No open files.</p>}
    </MobileSheet>
  );
}
