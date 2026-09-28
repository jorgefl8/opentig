/** Prefer the upstream remote's symbolic default, then conventional local refs. */
export function selectHistoryBase(output: string, upstream: string | null): { ref: string; oid: string } | null {
  const refs = output.trim().split('\n').map((line) => {
    const [ref = '', oid = '', target = ''] = line.split('\0');
    return { ref, oid, target };
  }).filter((ref) => /^[a-f0-9]{40,64}$/i.test(ref.oid));
  const remoteDefaults = refs.filter((ref) => ref.ref.startsWith('refs/remotes/') && ref.ref.endsWith('/HEAD') && ref.target);
  const preferred = remoteDefaults.filter((ref) => upstream?.startsWith(ref.ref.slice('refs/remotes/'.length, -4)))
    .sort((a, b) => b.ref.length - a.ref.length)[0]
    ?? remoteDefaults.find((ref) => ref.ref === 'refs/remotes/origin/HEAD');
  if (preferred) return { ref: preferred.target.replace(/^refs\/(heads|remotes)\//, ''), oid: preferred.oid };
  const remotePrefix = upstream?.split('/')[0] ?? 'origin';
  for (const name of [`refs/remotes/${remotePrefix}/main`, `refs/remotes/${remotePrefix}/master`, 'refs/heads/main', 'refs/heads/master']) {
    const ref = refs.find((candidate) => candidate.ref === name);
    if (ref) return { ref: name.replace(/^refs\/(heads|remotes)\//, ''), oid: ref.oid };
  }
  return null;
}
