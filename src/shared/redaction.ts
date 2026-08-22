/** Removes credential-shaped values before text reaches logs or clients. */
export function redactSensitiveText(value: string): string {
  const withoutHeaders = value
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  return withoutHeaders.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => redactUrl(candidate));
}

function redactUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    if (url.username || url.password) {
      url.username = '[redacted]';
      url.password = '';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[redacted-url]';
  }
}
