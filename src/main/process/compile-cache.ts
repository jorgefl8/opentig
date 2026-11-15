import module from 'node:module';
import os from 'node:os';
import path from 'node:path';

/**
 * Turns on V8's compile cache for the code this process loads from here on, as T3 Code
 * does: the next start reuses the compiled code instead of parsing it again. It holds
 * compiled code only. On Linux /tmp is shared between users, so the user's cache folder
 * is used there; elsewhere the temporary folder is already per user.
 */
export function enableCompileCache(): void {
  try {
    if (process.env.NODE_DISABLE_COMPILE_CACHE) return;
    const root = process.platform === 'linux'
      ? process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
      : os.tmpdir();
    module.enableCompileCache?.(path.join(root, 'opentig', 'compile-cache'));
  } catch { /* Starting without the cache is only slower. */ }
}
