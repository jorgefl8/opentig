export const SOURCE_EDITOR_VIRTUALIZATION_LINE_THRESHOLD = 2_000;

/**
 * Pierre recommends its Virtualizer for large editable files. Keeping ordinary
 * files on the base File surface also avoids involving virtual layout while a
 * structural edit (such as appending blank lines) is still being reconciled.
 */
export function shouldVirtualizeSourceEditor(
  contents: string,
  lineThreshold = SOURCE_EDITOR_VIRTUALIZATION_LINE_THRESHOLD,
): boolean {
  let lines = 1;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents.charCodeAt(index) !== 10) continue;
    lines += 1;
    if (lines > lineThreshold) return true;
  }
  return false;
}
