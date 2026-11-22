import { cloneFileDiffMetadata, hydratePartialDiff, type FileDiffMetadata } from '@pierre/diffs';
import { FILE_VERSION_MAX_BYTES, type FileVersion, type FileVersionsResult } from '@shared/contracts';
import { wholeDiffHighlightKey } from './highlight-cache-key';
import { createReadGate } from './read-gate';

/**
 * A diff parsed from its patch knows only the lines of its hunks, so each hunk
 * is highlighted out of context: one that starts inside a block, a comment or
 * a string opened above it is read as something else. With both files, the
 * same hunks are highlighted where they really are, and the unmodified lines
 * before and between them can be shown.
 *
 * Each file is kept up to the end of the last hunk. A grammar reads forward,
 * so what follows changes no color above it; and the diff then counts as many
 * lines as its patch did, so its line numbers keep their width and no row of
 * unmodified lines is added after the last hunk: shown in place of the patch,
 * its lines stay exactly where they were.
 */

/**
 * What one document reads whole at most, together: what Expand all reads of a pull request's diffs. It is
 * as much as the reads at once may each ask for, so reads under way never hold back the next.
 */
export const WHOLE_FILE_DOCUMENT_CHARACTERS = 4 * 1024 * 1024;
/**
 * Lines of both files together, at most. The highlight cache keeps 40,000 lines of diffs: a diff past half
 * of it would push out everything else, or not be kept at all and be tokenized again, whole, each time it
 * is folded, unfolded or shown split. Far below the 100,000 lines past which Pierre does not color a diff.
 */
export const WHOLE_FILE_MAX_LINES = 20_000;
/** Files read whole at once, so many unfolded files reach the server a few at a time. */
const READS_AT_ONCE = 2;

/** Reads both versions of one file, within `maxBytes` together. */
export type FileVersionsReader = (signal: AbortSignal, maxBytes: number) => Promise<FileVersionsResult>;

/** Only a change with lines on both sides has context to gain: an added or deleted file's patch is the whole file already. */
export function gainsFromWholeFiles(diff: FileDiffMetadata): boolean {
  return diff.isPartial && (diff.type === 'change' || diff.type === 'rename-changed') && diff.hunks.length > 0 && diff.cacheKey !== undefined;
}

/**
 * The patch's diff with both whole files, keeping the patch's hunks. Null unless the files are the ones
 * the patch compares: each blob the patch names, and every line of every hunk, at the same place in the
 * same file. Line endings, whitespace or a text conversion that made Git show other text than the files
 * hold keep the patch alone, rather than show something else than Git does.
 */
export function wholeFileDiff(partial: FileDiffMetadata, versions: { old: FileVersion | null; new: FileVersion | null }): FileDiffMetadata | null {
  if (!gainsFromWholeFiles(partial) || !versions.old || !versions.new) return null;
  if (!sameBlob(partial.prevObjectId, versions.old.oid) || !sameBlob(partial.newObjectId, versions.new.oid)) return null;
  const last = partial.hunks.at(-1)!;
  const oldContent = firstLines(versions.old.content, hunkSideEnd(last.deletionStart, last.deletionCount));
  const newContent = firstLines(versions.new.content, hunkSideEnd(last.additionStart, last.additionCount));
  let whole: FileDiffMetadata;
  try {
    whole = hydratePartialDiff('clone', partial, {
      oldFile: { name: partial.prevName ?? partial.name, contents: oldContent },
      newFile: { name: partial.name, contents: newContent },
    });
  } catch {
    return null;
  }
  if (whole.deletionLines.length + whole.additionLines.length > WHOLE_FILE_MAX_LINES || !sameHunks(partial, whole)) return null;
  whole.cacheKey = wholeDiffHighlightKey(partial.cacheKey!, oldContent, newContent);
  return whole;
}

/** How many lines of its file a hunk's side reaches, as `@@ -start,count` counts them: an empty side sits after line `start`. */
function hunkSideEnd(start: number, count: number): number {
  return count === 0 ? start : start - 1 + count;
}

/** The text up to the end of its `count`th line, or all of it when it has no more. */
function firstLines(text: string, count: number): string {
  let end = 0;
  for (let line = 0; line < count; line++) {
    const newline = text.indexOf('\n', end);
    if (newline < 0) return text;
    end = newline + 1;
  }
  return text.slice(0, end);
}

/** A patch names blobs by an abbreviated id; Git shows a working-tree file's as zeros or not at all. */
function sameBlob(abbreviated: string | undefined, oid: string | null): boolean {
  if (!abbreviated || oid === null || /^0+$/.test(abbreviated)) return true;
  return oid.toLowerCase().startsWith(abbreviated.toLowerCase());
}

/** Every line the patch shows is the line at that place in the whole file, on each side. */
function sameHunks(partial: FileDiffMetadata, whole: FileDiffMetadata): boolean {
  if (partial.hunks.length !== whole.hunks.length) return false;
  const same = (from: readonly string[], fromIndex: number, to: readonly string[], toIndex: number, count: number) => {
    if (toIndex < 0 || toIndex + count > to.length) return false;
    for (let offset = 0; offset < count; offset++) if (from[fromIndex + offset] !== to[toIndex + offset]) return false;
    return true;
  };
  for (let hunkIndex = 0; hunkIndex < partial.hunks.length; hunkIndex++) {
    const parts = partial.hunks[hunkIndex]!.hunkContent;
    const wholeParts = whole.hunks[hunkIndex]!.hunkContent;
    if (parts.length !== wholeParts.length) return false;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      const wholePart = wholeParts[index]!;
      const deletions = part.type === 'context' ? part.lines : part.deletions;
      const additions = part.type === 'context' ? part.lines : part.additions;
      if (!same(partial.deletionLines, part.deletionLineIndex, whole.deletionLines, wholePart.deletionLineIndex, deletions)) return false;
      if (!same(partial.additionLines, part.additionLineIndex, whole.additionLines, wholePart.additionLineIndex, additions)) return false;
    }
  }
  return true;
}

/**
 * What one document has read whole, by file: the diff for the patch it was read for, or null when it could
 * not be, so it is not asked again. Together they stay within `limit` characters; a file past what is left
 * keeps its patch alone. A file whose patch changes is read again, and what it held is given back first.
 */
export class WholeFileDiffs {
  private readonly held = new Map<string, { patchKey: string; diff: FileDiffMetadata | null; characters: number }>();
  /** What reads under way may still bring, by file. */
  private readonly pending = new Map<string, number>();
  private readonly gate = createReadGate(READS_AT_ONCE);

  constructor(private readonly limit = WHOLE_FILE_DOCUMENT_CHARACTERS) {}

  /** The whole-file diff kept for this patch of the file, a copy for one viewer; null when it could not be read; undefined when not read. */
  kept(fileKey: string, partial: FileDiffMetadata): FileDiffMetadata | null | undefined {
    const entry = this.held.get(fileKey);
    if (!entry || entry.patchKey !== partial.cacheKey) return undefined;
    return entry.diff && cloneFileDiffMetadata(entry.diff);
  }

  /** Reads the file whole, if what is left allows when its turn comes; resolves with null when the patch stays alone. */
  async load(fileKey: string, partial: FileDiffMetadata, read: FileVersionsReader, signal: AbortSignal): Promise<FileDiffMetadata | null> {
    const kept = this.kept(fileKey, partial);
    if (kept !== undefined) return kept;
    // What the file held for an earlier patch is given back.
    this.held.delete(fileKey);
    if (!gainsFromWholeFiles(partial)) return null;
    const diff = await this.gate(async () => {
      const room = this.room(fileKey);
      // Never recorded: room may free up once another file's patch changes.
      if (room <= 0) return null;
      this.pending.set(fileKey, room);
      try {
        const result = await read(signal, room);
        // Refused for want of room, a file may be read once room frees up: only a refusal at the full allowance is final.
        if (result.status === 'unavailable' && room < 2 * FILE_VERSION_MAX_BYTES) return null;
        const whole = result.status === 'ready' ? wholeFileDiff(partial, result) : null;
        const characters = whole && result.status === 'ready' ? (result.old?.content.length ?? 0) + (result.new?.content.length ?? 0) : 0;
        // Recorded before the next read in line measures what is left.
        this.held.set(fileKey, { patchKey: partial.cacheKey!, diff: whole, characters });
        return whole;
      } finally {
        if (this.pending.get(fileKey) === room) this.pending.delete(fileKey);
      }
    }, signal);
    return diff && cloneFileDiffMetadata(diff);
  }

  /** What one more file may read: the limit, less what the others hold and what reads under way may bring. */
  private room(fileKey: string): number {
    let used = 0;
    for (const [key, entry] of this.held) if (key !== fileKey) used += entry.characters;
    for (const [key, characters] of this.pending) if (key !== fileKey) used += characters;
    return Math.min(this.limit - used, 2 * FILE_VERSION_MAX_BYTES);
  }
}
