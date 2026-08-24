export function normalizeExternalOrigin(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new Error('Enter a valid HTTPS URL, for example https://opentig.example.com.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('External URL must be an HTTPS origin without a path, query, credentials, or fragment.');
  }
  return url.origin.toLowerCase();
}
