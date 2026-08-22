import { normalizeExternalUrl } from '@shared/external-url';

let activeCutTransfer: { paths: string[]; transferId: string } | null = null;

export async function readClipboardText(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error('Text clipboard access is unavailable.');
  return navigator.clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Text clipboard access is unavailable.');
  await navigator.clipboard.writeText(text);
  activeCutTransfer = null;
}

export async function writeFileTransfer(paths: string[], cutTransferId?: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Text clipboard access is unavailable.');
  await navigator.clipboard.writeText(paths.join('\r\n'));
  activeCutTransfer = cutTransferId ? { paths: [...paths], transferId: cutTransferId } : null;
}

export function fileCutTransferId(paths: string[]): string | null {
  if (!activeCutTransfer || !samePaths(activeCutTransfer.paths, paths)) {
    activeCutTransfer = null;
    return null;
  }
  return activeCutTransfer.transferId;
}

export function openExternalUrl(value: string): void {
  const url = normalizeExternalUrl(value);
  if (!url) throw new Error('Only web or mail links can be opened.');
  window.open(url, '_blank', 'noopener,noreferrer');
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
