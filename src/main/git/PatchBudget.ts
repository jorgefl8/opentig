export interface PatchAllocation {
  value: string;
  truncated: boolean;
}

const TRIM_MARKER = '[diff trimmed by OpenTig]';

/**
 * Fits a multi-file patch into a character budget without letting the first
 * files eat it all.
 *
 * Cutting the concatenated patch at a fixed offset is ordered by path, so the
 * files Git happens to emit last arrive with no content at all and the model can
 * only guess at them from their names. Instead every file gets an equal share of
 * the budget, files smaller than their share hand the remainder back, and what
 * is left over is redistributed to the larger ones. A file is therefore trimmed
 * in the middle rather than dropped, and its header always survives.
 */
export function allocatePatchBudget(patch: string, budget: number): PatchAllocation {
  if (patch.length <= budget) return { value: patch, truncated: false };

  const sections = splitFileSections(patch);
  if (sections.length <= 1) return { value: trimSection(patch, budget), truncated: true };

  // Smallest first, so each pass hands its unused share to the files still to
  // come instead of stranding budget on files that did not need it.
  const order = sections
    .map((section, index) => ({ index, section }))
    .sort((left, right) => left.section.length - right.section.length);

  const allocated = new Array<string>(sections.length);
  let remaining = budget;
  let pending = order.length;
  let truncated = false;
  for (const { index, section } of order) {
    const share = Math.floor(remaining / pending);
    if (section.length <= share) {
      allocated[index] = section;
      remaining -= section.length;
    } else {
      const trimmed = trimSection(section, share);
      allocated[index] = trimmed;
      remaining -= trimmed.length;
      truncated = true;
    }
    pending -= 1;
  }
  return { value: allocated.join(''), truncated };
}

/** Splits a patch before each `diff --git` header, keeping any preamble. */
function splitFileSections(patch: string): string[] {
  return patch.split(/^(?=diff --git )/m).filter((section) => section.length > 0);
}

/**
 * Keeps the start of a section and cuts on a line boundary, so the file header
 * and the first hunks stay readable instead of ending mid-line.
 */
function trimSection(section: string, limit: number): string {
  const room = limit - TRIM_MARKER.length - 2;
  if (room <= 0) return `${firstLine(section)}\n${TRIM_MARKER}\n`;
  const head = section.slice(0, room);
  const lastBreak = head.lastIndexOf('\n');
  const body = lastBreak > 0 ? head.slice(0, lastBreak) : head;
  return `${body}\n${TRIM_MARKER}\n`;
}

function firstLine(section: string): string {
  const end = section.indexOf('\n');
  return end < 0 ? section : section.slice(0, end);
}
