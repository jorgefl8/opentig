import type { WindowsDownload } from './downloads';
import { installerScan, type InstallerScan } from './installer-scan.ts';

export const scanNotesStart = '<!-- opentig:installer-scan:start';
export const scanNotesEnd = 'opentig:installer-scan:end -->';
const maxManifestLength = 16384;

function scanBlock(body: string) {
  const start = body.indexOf(scanNotesStart);
  const end = body.indexOf(scanNotesEnd);
  if (start < 0 && end < 0) return;
  if (start < 0 || end < start + scanNotesStart.length
    || body.indexOf(scanNotesStart, start + 1) >= 0 || body.indexOf(scanNotesEnd, end + 1) >= 0) {
    throw new Error('Installer scan notes have missing, duplicate or misplaced markers.');
  }
  const content = body.slice(start + scanNotesStart.length, end);
  if (content.length > maxManifestLength || content.includes('<!--') || content.includes('-->')) {
    throw new Error('Installer scan notes contain an invalid comment or oversized manifest.');
  }
  return { start, end: end + scanNotesEnd.length, content };
}

/** Reads public metadata without interpreting release notes as HTML. */
export function scanFromNotes(body: unknown, download: WindowsDownload): InstallerScan | undefined {
  if (typeof body !== 'string') return;
  try {
    const block = scanBlock(body);
    return block ? installerScan(JSON.parse(block.content), download) : undefined;
  } catch {
    return;
  }
}

/** Returns edited notes locally; performs no GitHub writes. */
export function notesWithScan(body: string, value: unknown, download: WindowsDownload): string {
  const scan = installerScan(value, download);
  if (!scan) throw new Error('Installer scan does not match this release asset or has invalid metadata.');
  const existing = scanBlock(body);
  if (existing) {
    const previous = scanFromNotes(body, download);
    if (!previous) throw new Error('Existing installer scan metadata is invalid or belongs to another asset.');
    if (previous.updatedAt > scan.updatedAt
      || previous.updatedAt === scan.updatedAt && JSON.stringify(previous) !== JSON.stringify(scan)) {
      throw new Error('Refusing to overwrite newer or conflicting installer scan metadata.');
    }
  }
  // Keep public JSON inside one HTML comment even if the contract gains text fields.
  const json = JSON.stringify(scan).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  if (json.length > maxManifestLength) throw new Error('Installer scan manifest is too large.');
  const block = `${scanNotesStart}\n${json}\n${scanNotesEnd}`;
  const separator = !body || body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  const updated = existing ? body.slice(0, existing.start) + block + body.slice(existing.end) : body + separator + block;
  if (new TextEncoder().encode(updated).length > 120000) throw new Error('Release notes exceed the supported size.');
  return updated;
}
