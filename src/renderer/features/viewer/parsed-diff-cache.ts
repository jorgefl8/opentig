import { cloneFileDiffMetadata } from '@pierre/diffs';
import { ByteBudgetLru } from '@/lib/ByteBudgetLru';
import type { DiffFileEntry } from './patch-utils';

export const PARSED_DIFF_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const PARSED_DIFF_CACHE_MAX_ENTRY_BYTES = 4 * 1024 * 1024;

/** Conservative UTF-16 estimate including the key/source, per-file patches,
 * line strings and array slots, hunk segments, and metadata. This is a budget
 * for retained parse models, not a measurement of total renderer/worker heap. */
export function estimateParsedDiffBytes(patch: string, files: DiffFileEntry[]): number {
  let bytes = patch.length * 2 + 64;
  for (const file of files) {
    bytes += file.patch.length * 2 + (file.path.length + (file.previousPath?.length ?? 0) + file.key.length) * 2 + 512;
    for (const line of file.fileDiff.additionLines) bytes += line.length * 2 + 64;
    for (const line of file.fileDiff.deletionLines) bytes += line.length * 2 + 64;
    for (const hunk of file.fileDiff.hunks) {
      bytes += 256 + hunk.hunkContent.length * 128 + ((hunk.hunkContext?.length ?? 0) + (hunk.hunkSpecs?.length ?? 0)) * 2;
    }
  }
  return bytes;
}

function cloneEntries(files: DiffFileEntry[]): DiffFileEntry[] {
  return files.map(file => ({ ...file, fileDiff: cloneFileDiffMetadata(file.fileDiff) }));
}

/** Owned by a mounted document. No global repository retention or TTL timers.
 * Pierre can mutate metadata; keep cache copies separate from rendered copies. */
export class ParsedDiffCache {
  private readonly entries = new ByteBudgetLru<string, { files: DiffFileEntry[]; bytes: number }>({
    maxEntries: 4, maxBytes: PARSED_DIFF_CACHE_MAX_BYTES, sizeOf: entry => entry.bytes,
  });

  get bytes() { return this.entries.bytes; }
  get size() { return this.entries.size; }

  get(patch: string): DiffFileEntry[] | undefined {
    const entry = this.entries.get(patch);
    return entry ? cloneEntries(entry.files) : undefined;
  }

  set(patch: string, files: DiffFileEntry[]): boolean {
    // Avoid another walk/clone for patches that cannot fit even without metadata.
    if (patch.length * 2 > PARSED_DIFF_CACHE_MAX_ENTRY_BYTES) return false;
    const bytes = estimateParsedDiffBytes(patch, files);
    if (bytes > PARSED_DIFF_CACHE_MAX_ENTRY_BYTES) return false;
    return this.entries.set(patch, { files: cloneEntries(files), bytes });
  }

  clear() { this.entries.clear(); }
}
