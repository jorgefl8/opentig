import type { CommitInfo } from '../../shared/git-types';

const FIELD = '\x1f';
const RECORD = '\x1e';

export const LOG_FORMAT = `%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%D${FIELD}%P${RECORD}`;

export function parseLog(output: string): CommitInfo[] {
  return output.split(RECORD).map((record) => record.trim()).filter(Boolean).flatMap((record) => {
    const fields = record.split(FIELD);
    if (fields.length < 8) return [];
    const oid = fields[0] ?? '';
    if (!/^[0-9a-f]{40,64}$/i.test(oid)) return [];
    return [{
      oid,
      shortOid: fields[1] ?? oid.slice(0, 7),
      subject: fields[2] ?? '',
      author: fields[3] ?? '',
      email: fields[4] ?? '',
      date: fields[5] ?? '',
      decorations: (fields[6] ?? '').split(',').map((value) => value.trim()).filter(Boolean),
      parentCount: (fields[7] ?? '').split(' ').filter(Boolean).length,
      upstreamState: 'unknown',
      isHead: false,
    }];
  });
}
