import { sileo } from 'sileo';
import { writeClipboardText } from '@/lib/browser-capabilities';

export async function copyCommitHash(oid: string): Promise<void> {
  try {
    await writeClipboardText(oid);
    sileo.success({ title: 'Hash copied', description: oid });
  } catch {
    sileo.error({ title: 'Could not copy hash' });
  }
}
