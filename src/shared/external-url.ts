const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/** Returns a canonical external URL, or null when navigation must stay blocked. */
export function normalizeExternalUrl(value: string): string | null {
  const candidate = value.startsWith('//') ? `https:${value}` : value;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return null; }
  return EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
}
