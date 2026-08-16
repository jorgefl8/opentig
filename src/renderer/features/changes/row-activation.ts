const INTERACTIVE_ROW_TARGET = 'button, a, input, select, textarea, [role="button"]';

interface ClosestTarget {
  closest(selector: string): unknown;
}

/**
 * Rows paint one continuous hover surface, so clicks on their non-control
 * spacing should activate the row's primary action too. Nested controls keep
 * their own action and must not also trigger the row.
 */
export function shouldActivateChangeRow(target: EventTarget | null): boolean {
  const closest = (target as Partial<ClosestTarget> | null)?.closest;
  return typeof closest !== 'function' || closest.call(target, INTERACTIVE_ROW_TARGET) == null;
}
