import { getVsCodeFolderIconUrl } from '@/lib/vscode-icons';

/** The icon of a folder's kind, such as src or test, like the one each file has for its type. */
export function FolderIcon({ path, expanded = false }: { path: string; expanded?: boolean }) {
  return <img className="vscode-tree-icon folder-icon" src={getVsCodeFolderIconUrl(path, expanded)} alt="" aria-hidden="true" draggable={false} />;
}
