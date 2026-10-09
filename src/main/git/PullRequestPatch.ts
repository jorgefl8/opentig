import type { CommitFile } from '../../shared/git-types';
import type { PullRequestContextFile } from '../../shared/pull-request-context';

const OMITTED = '[hunk content omitted by OpenTig]\n';

function changedLines(text: string): number {
  const start = text.search(/^@@ /m);
  return start < 0 ? 0 : text.slice(start).split('\n').filter(line => /^[+-]/.test(line)).length;
}

/** Strict character limit, including omission markers. Files remain in Git's order. */
export function allocatePullRequestPatch(patch: string, inventory: CommitFile[], budget: number): {
  value: string; files: PullRequestContextFile[];
} {
  const sections = patch.split(/^(?=diff --git )/m).filter(Boolean);
  if (sections.length !== inventory.length || sections.some(section => !section.startsWith('diff --git '))) {
    throw new Error('The patch does not match the complete file inventory.');
  }
  const values = new Array<string>(sections.length);
  const files = new Array<PullRequestContextFile>(sections.length);
  const order = sections.map((section, index) => ({ section, index })).sort((a, b) => a.section.length - b.section.length);
  let remaining = Math.max(0, Math.floor(budget));
  let pending = order.length;
  for (const { section, index } of order) {
    const share = Math.floor(remaining / pending--);
    const result = selectHunks(section, share);
    values[index] = result.value;
    files[index] = {
      ...inventory[index]!,
      detail: result.value === section ? 'complete' : result.value ? 'partial' : 'inventory-only',
      omittedChangedLines: changedLines(section) - changedLines(result.value),
      omittedHunks: result.omittedHunks,
    };
    remaining -= result.value.length;
  }
  return { value: values.join(''), files };
}

function selectHunks(section: string, limit: number): { value: string; omittedHunks: number } {
  const parts = section.split(/^(?=@@ )/m);
  const header = parts.shift()!;
  if (section.length <= limit) return { value: section, omittedHunks: 0 };
  if (header.length + OMITTED.length > limit) return { value: '', omittedHunks: parts.length };
  // A header-only file (binary, mode change, rename) must be included in full.
  if (parts.length === 0) return { value: '', omittedHunks: 0 };

  const chosen = new Map<number, string>();
  let remaining = limit - header.length - OMITTED.length;
  // Alternate the first and last remaining hunk, without rearranging the output.
  const order: number[] = [];
  for (let left = 0, right = parts.length - 1; left <= right; left++, right--) {
    order.push(left);
    if (right !== left) order.push(right);
  }
  for (const index of order) {
    const hunk = parts[index]!;
    if (hunk.length <= remaining) {
      chosen.set(index, hunk);
      remaining -= hunk.length;
    }
  }
  // A huge hunk may not fit at all. Include a labelled prefix with its original
  // hunk header; the trailing marker explicitly says this is not an applicable patch.
  const fragmentIndex = order.find(index => !chosen.has(index));
  if (fragmentIndex !== undefined) {
    const hunk = parts[fragmentIndex]!;
    const end = hunk.lastIndexOf('\n', remaining - 1);
    if (remaining > 0 && end > hunk.indexOf('\n')) chosen.set(fragmentIndex, hunk.slice(0, end + 1));
  }
  const value = header + [...chosen.entries()].sort(([a], [b]) => a - b).map(([, hunk]) => hunk).join('') + OMITTED;
  return { value, omittedHunks: parts.filter((hunk, index) => chosen.get(index) !== hunk).length };
}
