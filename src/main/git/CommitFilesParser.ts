import type { ChangeKind, CommitFile } from '../../shared/git-types';

const STATUS_KINDS: Record<string, ChangeKind> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed', U: 'conflicted',
};

interface NumstatEntry { additions: number; deletions: number; binary: boolean }

/**
 * Combines the NUL-delimited outputs of `--name-status -z` and `--numstat -z`
 * for the same commit into a per-file summary.
 */
export function parseCommitFiles(nameStatusOutput: string, numstatOutput: string): CommitFile[] {
  const stats = parseNumstat(numstatOutput);
  const files: CommitFile[] = [];
  const tokens = nameStatusOutput.split('\0');
  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index];
    if (!status) continue;
    const letter = status[0]?.toUpperCase() ?? '';
    const kind = STATUS_KINDS[letter];
    if (!kind) continue;
    const renamed = letter === 'R' || letter === 'C';
    const first = tokens[index + 1];
    const second = renamed ? tokens[index + 2] : undefined;
    index += renamed ? 2 : 1;
    const path = renamed ? second : first;
    if (!path) continue;
    const stat = stats.get(path) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path, oldPath: renamed ? first ?? null : null, kind, additions: stat.additions, deletions: stat.deletions, binary: stat.binary });
  }
  return files;
}

function parseNumstat(output: string): Map<string, NumstatEntry> {
  const stats = new Map<string, NumstatEntry>();
  const tokens = output.split('\0');
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    if (!record) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(record);
    if (!match) continue;
    const binary = match[1] === '-' || match[2] === '-';
    const entry: NumstatEntry = {
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
      binary,
    };
    let path = match[3] ?? '';
    if (!path) {
      // Rename record: the path fields follow as two extra NUL-delimited tokens (old, new).
      path = tokens[index + 2] ?? '';
      index += 2;
    }
    if (path) stats.set(path, entry);
  }
  return stats;
}
