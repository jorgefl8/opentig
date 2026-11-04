import { createElement, lazy, useState, type ComponentType } from 'react';

// Browsers word a failed module load differently: Chromium, WebKit (Safari and every
// iOS browser), Firefox, and Vite's own CSS preloading.
const MODULE_LOAD_FAILURE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

/** A part of the app couldn't be downloaded: the connection dropped, or the server was updated and it's gone. */
export function isModuleLoadError(error: unknown): boolean {
  return MODULE_LOAD_FAILURE.test(error instanceof Error ? error.message : String(error));
}

const RETRY_DELAYS_MS = [400, 1500];

/** Tries a dropped download again before giving up; any other error fails at once. */
export async function importWithRetry<T>(load: () => Promise<T>, delays: readonly number[] = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= delays.length || !isModuleLoadError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/**
 * React.lazy, retrying a part that failed to download. React keeps a failed lazy
 * component failed, so without this a moment without connection breaks that part
 * until the page reloads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => importWithRetry(load));
}

/**
 * `lazyWithRetry` that can start downloading before it is shown. Once the code is
 * in, a new instance renders it directly: React keeps a lazy component's fallback
 * on screen for at least 300 ms the first time it suspends, even when the code
 * arrives sooner. An instance keeps the type it mounted with, so one shown while
 * loading isn't remounted when the code lands.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithPreload<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let loaded: T | null = null;
  let pending: Promise<{ default: T }> | null = null;
  const start = () => pending ??= importWithRetry(load).then(
    (module) => { loaded = module.default; return module; },
    (error: unknown) => { pending = null; throw error; },
  );
  const Lazy = lazy(start);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function Preloadable(props: any) {
    const [Component] = useState<ComponentType<unknown>>(() => (loaded ?? Lazy) as ComponentType<unknown>);
    return createElement(Component, props);
  }
  return Object.assign(Preloadable as unknown as T, {
    /** Starts the download; a failure is left for rendering, which retries and reports it. */
    preload: () => { void start().catch(() => undefined); },
  });
}
