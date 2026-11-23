import type { SearchablePickerItem } from './SearchablePicker';

/** Whether a row shows for a search, as the picker filters: by its group, label, description and search text. */
export function pickerItemMatches(groupLabel: string, item: SearchablePickerItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return Boolean(item.pinned) || `${groupLabel} ${item.label} ${item.description ?? ''} ${item.search ?? ''}`.toLocaleLowerCase().includes(needle);
}
