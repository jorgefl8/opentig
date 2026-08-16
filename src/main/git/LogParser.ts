import type { CommitInfo } from '../../shared/git-types';

const FIELD = '\x1f';
const RECORD = '\x1e';

export const LOG_FORMAT = `%H${FIELD}%h${FIELD}%s${FIELD}%b${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%D${FIELD}%P${RECORD}`;

export function parseLog(output: string): CommitInfo[] {
  return output.split(RECORD).map((record) => record.trim()).filter(Boolean).flatMap((record) => {
    const fields = record.split(FIELD);
    if (fields.length < 9) return [];
    const oid = fields[0] ?? '';
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) return [];
    return [{
      oid,
      shortOid: fields[1] ?? oid.slice(0, 7),
      subject: fields[2] ?? '',
      body: (fields[3] ?? '').trim(),
      author: fields[4] ?? '',
      email: fields[5] ?? '',
      date: fields[6] ?? '',
      decorations: (fields[7] ?? '').split(',').map((value) => value.trim()).filter(Boolean),
      parentCount: (fields[8] ?? '').split(' ').filter(Boolean).length,
      upstreamState: 'unknown',
      isHead: false,
    }];
  });
}
