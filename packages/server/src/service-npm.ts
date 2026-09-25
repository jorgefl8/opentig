import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execute } from './service-installation';

/** Run npm's JS entry with Node, never a .cmd file or interpolated shell command. */
export async function runServiceNpm(args: string[], cwd?: string): Promise<void> {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    candidates.push(path.join(directory, 'node_modules/npm/bin/npm-cli.js'));
    if (process.platform !== 'win32') {
      try { candidates.push(await realpath(path.join(directory, 'npm'))); } catch { /* Next PATH entry. */ }
    }
  }
  for (const candidate of candidates) {
    // npm_execpath can point to bun or another package manager.
    if (!candidate || path.basename(candidate) !== 'npm-cli.js') continue;
    try { await access(candidate); } catch { continue; }
    await execute(process.execPath, [candidate, ...args], { cwd, timeout: 180_000, maxBuffer: 2_000_000, windowsHide: true });
    return;
  }
  throw new Error('npm could not be located. Install Node.js with npm and run service install from that terminal.');
}
