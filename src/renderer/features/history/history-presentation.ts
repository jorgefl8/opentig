import type { CommitInfo } from '@shared/git-types';

export interface CommitReference { number: number; source: 'merge' | 'subject'; }

/** Message references are hints, not proof of a PR's state or merge method. */
export function commitReference(commit: Pick<CommitInfo, 'subject' | 'parentCount'>): CommitReference | null {
  const merge = commit.parentCount > 1 && /^Merge pull request #(\d+)\b/i.exec(commit.subject);
  const suffix = /\(#(\d+)\)\s*$/.exec(commit.subject);
  const value = merge || suffix;
  if (!value) return null;
  const number = Number(value[1]);
  return Number.isSafeInteger(number) && number > 0 ? { number, source: merge ? 'merge' : 'subject' } : null;
}

export function historyColor(commit: CommitInfo): number | undefined {
  if (commit.upstreamState === 'local-only') return 0;
  if (commit.baseState === 'included') return 2;
  if (commit.upstreamState === 'published') return 1;
  return undefined;
}

export interface HistoryRow { commit: CommitInfo; parentOids: string[]; grouped: CommitInfo[]; }

/** Collapse only complete, exclusive, linear merge branches in the loaded page. */
export function historyRows(commits: readonly CommitInfo[], grouped: boolean): HistoryRow[] {
  if (!grouped) return commits.map((commit) => ({ commit, parentOids: commit.parentOids, grouped: [] }));
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const children = new Map<string, Set<string>>();
  commits.forEach((commit) => commit.parentOids.forEach((oid) => {
    const set = children.get(oid) ?? new Set<string>(); set.add(commit.oid); children.set(oid, set);
  }));
  const hidden = new Set<string>();
  const rows: HistoryRow[] = [];
  for (const commit of commits) {
    if (hidden.has(commit.oid)) continue;
    const row: HistoryRow = { commit, parentOids: commit.parentOids, grouped: [] };
    rows.push(row);
    if (commit.parentOids.length !== 2) continue;
    const main = new Set<string>();
    let current = byOid.get(commit.parentOids[0]!);
    while (current && !main.has(current.oid)) { main.add(current.oid); current = byOid.get(current.parentOids[0] ?? ''); }
    let oid = commit.parentOids[1]!;
    const branch: CommitInfo[] = [];
    const visited = new Set<string>();
    while (!main.has(oid)) {
      const candidate = byOid.get(oid);
      if (!candidate || visited.has(oid) || hidden.has(oid) || candidate.isHead || candidate.parentOids.length !== 1) break;
      visited.add(oid); branch.push(candidate); oid = candidate.parentOids[0]!;
    }
    if (!main.has(oid) || branch.length === 0) continue;
    const allowed = new Set([commit.oid, ...branch.map((item) => item.oid)]);
    if (branch.some((item) => [...(children.get(item.oid) ?? [])].some((child) => !allowed.has(child)))) continue;
    // A malformed order must never hide a row that has already been emitted.
    if (branch.some((item) => rows.some((earlier) => earlier.commit.oid === item.oid))) continue;
    row.grouped = branch;
    row.parentOids = [commit.parentOids[0]!];
    branch.forEach((item) => hidden.add(item.oid));
  }
  return rows;
}

export function matchesHistory(commit: CommitInfo, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  return query.length > 0 && [commit.subject, commit.author, commit.oid, ...commit.decorations].some((text) => text.toLocaleLowerCase().includes(query));
}
