import { useMemo } from 'react';
import { IconBrandGithub, IconCopy, IconFileArrowRight, IconGitPullRequest, IconRestore, IconTextWrap } from '@tabler/icons-react';
import type { DiffResult } from '@shared/contracts';
import type { CommitInfo } from '@shared/git-types';
import { MobileActionsMenu, MobileViewerActions, MobileViewerTitle, type MobileMenuItem } from '@/components/MobileChrome';
import { copyCommitHash } from '@/features/history/copy-commit-hash';
import { canUndoCommit, commitGitHubUrl, commitReference } from '@/features/history/history-presentation';
import { openExternalUrl } from '@/lib/browser-capabilities';
import { patchLineStats } from './patch-utils';

const nameAndFolder = (path: string) => {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? { name: path, folder: '' } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
};

/** A diff's top bar: which file and how much changed, then what can be done with this change. */
export function MobileDiffBar({ path, kind, diff, wrapLines, readOnly, onOpenFile, onWrapLinesChange, onDiscard }: {
  path: string;
  kind: 'staged' | 'unstaged';
  diff: DiffResult | null;
  wrapLines: boolean;
  readOnly: boolean;
  onOpenFile(path: string): void;
  onWrapLinesChange(value: boolean): void;
  onDiscard?: ((path: string) => void) | undefined;
}) {
  const { name, folder } = nameAndFolder(path);
  const stats = useMemo(() => diff ? patchLineStats(diff.patch) : null, [diff]);
  const items: MobileMenuItem[] = [
    { label: 'Open file', icon: <IconFileArrowRight />, onSelect: () => onOpenFile(path) },
    { label: 'Wrap lines', icon: <IconTextWrap />, checked: wrapLines, onSelect: () => onWrapLinesChange(!wrapLines) },
    ...(onDiscard && kind === 'unstaged' ? [{ label: 'Discard changes', icon: <IconRestore />, danger: true, disabled: readOnly, onSelect: () => onDiscard(path) }] : []),
  ];
  return <>
    <MobileViewerTitle title={name} subtitle={(folder || stats) && <>
      {folder && <span className="mobile-viewer-folder">{folder}</span>}
      {folder && stats && ' · '}
      {stats && <span className="mobile-viewer-stats"><span className="add">+{stats.additions}</span> <span className="del">−{stats.deletions}</span></span>}
    </>} />
    <MobileViewerActions>
      <MobileActionsMenu label="More actions for this change" title={name} items={items} />
    </MobileViewerActions>
  </>;
}

/** A commit's top bar: its short hash, or a file of it with the hash below. */
export function MobileCommitBar({ oid, path, commit, canUndo, githubRepository, onUndo, onOpenPullRequest }: {
  oid: string;
  /** Set when one file of the commit is showing. */
  path?: string | undefined;
  commit: CommitInfo | undefined;
  canUndo: boolean;
  githubRepository: string | null | undefined;
  onUndo: ((commit: CommitInfo) => void) | undefined;
  onOpenPullRequest?: ((number: number) => void) | undefined;
}) {
  const shortOid = commit?.shortOid ?? oid.slice(0, 7);
  const githubUrl = commitGitHubUrl(githubRepository, oid, commit);
  const reference = commit && githubRepository && onOpenPullRequest ? commitReference(commit) : null;
  const items: MobileMenuItem[] = [
    { label: 'Copy hash', icon: <IconCopy />, onSelect: () => void copyCommitHash(oid) },
    ...(reference ? [{ label: `Open pull request #${reference.number}`, icon: <IconGitPullRequest />, onSelect: () => onOpenPullRequest!(reference.number) }] : []),
    ...(githubUrl ? [{ label: 'Open on GitHub', icon: <IconBrandGithub />, onSelect: () => openExternalUrl(githubUrl) }] : []),
    ...(commit && onUndo && canUndo && canUndoCommit(commit) ? [{ label: 'Undo commit…', icon: <IconRestore />, danger: true, onSelect: () => onUndo(commit) }] : []),
  ];
  return <>
    {path ? <MobileViewerTitle title={nameAndFolder(path).name} subtitle={<span className="mobile-viewer-mono">{shortOid}</span>} /> : <MobileViewerTitle title={shortOid} mono />}
    <MobileViewerActions><MobileActionsMenu label="More commit actions" title={`Commit ${shortOid}`} items={items} /></MobileViewerActions>
  </>;
}
