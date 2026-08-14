import type { WorktreeInfo } from '../../shared/git-types';

export function parseWorktrees(buffer: Buffer): WorktreeInfo[] {
  const fields = buffer.toString('utf8').split('\0');
  const worktrees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;
  for (const raw of fields) {
    const field = raw.trimStart();
    if (!field) continue;
    const separator = field.indexOf(' ');
    const key = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? '' : field.slice(separator + 1);
    if (key === 'worktree') {
      if (current) worktrees.push(current);
      // Git's list format guarantees the main worktree is the first record.
      current = { path: value, oid: '', branch: null, bare: false, detached: false, locked: null, prunable: null, main: worktrees.length === 0 };
    } else if (current) {
      if (key === 'HEAD') current.oid = value;
      else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'bare') current.bare = true;
      else if (key === 'detached') current.detached = true;
      else if (key === 'locked') current.locked = value || 'locked';
      else if (key === 'prunable') current.prunable = value || 'prunable';
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}
