import { IconFolder } from '@tabler/icons-react';

/**
 * Folders stay neutral in file trees, leaving colour to file types and state.
 * The chevron beside one says whether it is open.
 */
export function FolderIcon() {
  return <IconFolder className="folder-icon" aria-hidden="true" />;
}
