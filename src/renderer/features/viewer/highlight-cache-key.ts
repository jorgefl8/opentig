/**
 * Pierre's highlight cache trusts its key: whatever was tokenized under a key is
 * shown for every later file or diff that carries it. A key built from the
 * content itself can therefore be shared between mounts, so reopening a file,
 * folding a diff or switching to the split view finds its colors already there.
 * The theme is not part of the key: the pool empties its cache when it changes.
 */

/** Two 32-bit halves (cyrb53's mixing) plus the length, so unrelated texts do not meet under one key. */
export function contentHash(text: string): string {
  let high = 0xdeadbeef;
  let low = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    high = Math.imul(high ^ code, 2654435761);
    low = Math.imul(low ^ code, 1597334677);
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
  return `${text.length.toString(36)}.${(high >>> 0).toString(36)}.${(low >>> 0).toString(36)}`;
}

/** The same path with the same text is the same highlighted file, on any mount. */
export function fileHighlightKey(path: string, content: string): string {
  return `${path}\u0000${contentHash(content)}`;
}

/** One file's patch names its paths, so its text and the grammar that reads it identify its highlighted diff. */
export function diffHighlightKey(filePatch: string, language: string): string {
  return `diff\u0000${language}\u0000${contentHash(filePatch)}`;
}

/**
 * A diff read with both whole files is tokenized from their first lines, and so is colored unlike the
 * same patch read alone: its key adds both texts to the patch's own key, which it never equals.
 */
export function wholeDiffHighlightKey(patchKey: string, oldContent: string, newContent: string): string {
  return `whole\u0000${patchKey}\u0000${contentHash(oldContent)}\u0000${contentHash(newContent)}`;
}
