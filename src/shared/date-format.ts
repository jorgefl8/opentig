const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

function localDate(value: string): Date {
  // A date without a time denotes a calendar day, rather than midnight UTC.
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
}

function dateText(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear(), 4)}`;
}

/** Display a calendar date as DD/MM/YYYY in the current local timezone. */
export function formatDate(value: string): string {
  const date = localDate(value);
  return Number.isNaN(date.getTime()) ? '—' : dateText(date);
}

/** Display a local date and 24-hour time, retaining seconds when needed. */
export function formatDateTime(value: string, { seconds = false }: { seconds?: boolean } = {}): string {
  const date = localDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ''}`;
  return `${dateText(date)} ${time}`;
}
