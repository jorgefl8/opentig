import type { Preferences } from './contracts';

/** Value-based identity: changing a model or cloning preferences does not invalidate CLI checks. */
export function aiExecutablePathsKey(paths: Preferences['aiExecutablePaths']): string {
  return JSON.stringify((['codex', 'claude', 'opencode', 'grok'] as const).map((id) => paths[id] ?? ''));
}
