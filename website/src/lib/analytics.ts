type EventName = 'open_downloads' | 'open_installation_guide' | 'copy_cli_command';
type EventData = { placement: string };

declare global {
  interface Window {
    umami?: { track: (name: string, data: EventData) => unknown };
  }
}

/** Count navigation intent, never a completed download or installation. */
export function installationEvent(href: string, currentHref: string): EventName | undefined {
  const url = new URL(href, currentHref);
  const current = new URL(currentHref);
  if (url.origin === 'https://github.com' && url.pathname === '/jorgefl8/opentig/releases/latest') return 'open_downloads';
  if (url.origin === current.origin && url.pathname === '/docs/getting-started/' && url.pathname !== current.pathname) return 'open_installation_guide';
  return undefined;
}

/** Tracking is optional and must never break navigation or clipboard feedback. */
export function trackEvent(name: EventName, data: EventData, tracker = window.umami): void {
  try {
    void Promise.resolve(tracker?.track(name, data)).catch(() => {});
  } catch {
    // A blocked or unavailable tracker must not affect the action.
  }
}
