import type { ChangeKind, FileChange, RepositoryStatus } from '../../shared/git-types';

function kindFor(code: string): ChangeKind {
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('C')) return 'copied';
  if (code.includes('A') || code === '??') return code === '??' ? 'untracked' : 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('T')) return 'type-changed';
  return 'modified';
}

export function parseStatus(buffer: Buffer): RepositoryStatus {
  const status: RepositoryStatus = {
    branch: null, oid: null, upstream: null, ahead: 0, behind: 0, insertions: 0, deletions: 0,
    detached: false, unborn: false, operation: null, readOnly: false,
    changes: [], stagedCount: 0, unstagedCount: 0,
  };
  const chunks = splitNul(buffer).map((chunk) => chunk.toString('utf8'));
  for (let index = 0; index < chunks.length; index += 1) {
    const record = chunks[index] ?? '';
    if (!record) continue;
    if (record.startsWith('# ')) { parseHeader(record, status); continue; }
    if (record.startsWith('? ')) {
      status.changes.push(makeChange(record.slice(2), '?', '?'));
      continue;
    }
    if (record.startsWith('1 ') || record.startsWith('u ')) {
      const fields = record.split(' ');
      const xy = fields[1] ?? '..';
      const pathIndex = record.startsWith('1 ') ? 8 : 10;
      status.changes.push(makeChange(fields.slice(pathIndex).join(' '), xy[0] ?? '.', xy[1] ?? '.', fields[2] ?? ''));
      continue;
    }
    if (record.startsWith('2 ')) {
      const fields = record.split(' ');
      const xy = fields[1] ?? '..';
      const next = chunks[index + 1] ?? '';
      const pathValue = fields.slice(9).join(' ');
      status.changes.push({ ...makeChange(pathValue, xy[0] ?? '.', xy[1] ?? '.', fields[2] ?? ''), originalPath: next });
      index += 1;
    }
  }
  status.stagedCount = status.changes.filter((change) => change.staged && !change.conflict).length;
  status.unstagedCount = status.changes.filter((change) => change.unstaged && !change.conflict).length;
  return status;
}

function splitNul(buffer: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    records.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start < buffer.length) records.push(buffer.subarray(start));
  return records;
}

function parseHeader(line: string, status: RepositoryStatus): void {
  if (line.startsWith('# branch.oid ')) {
    const oid = line.slice(13);
    status.oid = oid === '(initial)' ? null : oid;
    status.unborn = oid === '(initial)';
  } else if (line.startsWith('# branch.head ')) {
    const head = line.slice(14);
    status.detached = head === '(detached)';
    status.branch = status.detached ? null : head;
  } else if (line.startsWith('# branch.upstream ')) {
    status.upstream = line.slice(18);
  } else if (line.startsWith('# branch.ab ')) {
    const match = /\+(\d+) -(\d+)/.exec(line);
    if (match) { status.ahead = Number(match[1]); status.behind = Number(match[2]); }
  }
}

function makeChange(path: string, indexStatus: string, worktreeStatus: string, submodule = ''): FileChange {
  const code = `${indexStatus}${worktreeStatus}`;
  const conflict = kindFor(code) === 'conflicted';
  return {
    path, indexStatus, worktreeStatus, kind: kindFor(code),
    staged: indexStatus !== '.' && indexStatus !== '?',
    unstaged: worktreeStatus !== '.' || code === '??',
    conflict, submodule,
  };
}
