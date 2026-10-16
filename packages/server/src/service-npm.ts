import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execute } from './service-installation';
import { CliError } from './cli-errors';

/** Run npm's JS entry with Node, never a .cmd file or interpolated shell command. */
export async function runServiceNpm(args: string[], cwd?: string): Promise<void> {
  const entry = await resolveServiceNpm();
  try { await execute(process.execPath, [entry, ...args], { cwd, timeout: 180_000, maxBuffer: 2_000_000, windowsHide: true }); }
  catch (cause) {
    const stderr = cause && typeof cause === 'object' && 'stderr' in cause && typeof cause.stderr === 'string' ? cause.stderr : '';
    const code = stderr.match(/npm (?:error|ERR!) code (E[A-Z0-9]+)/)?.[1];
    const action = code && ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'].includes(code)
      ? 'npm could not reach the package registry. Check the network and npm proxy/registry configuration.'
      : code === 'E401' || code === 'E403' ? 'npm registry access was denied. Check npm authentication and registry policies.'
        : code === 'ENOSPC' ? 'npm ran out of disk space. Free space on the service volume and npm cache volume.'
          : code === 'EACCES' || code === 'EPERM' ? 'npm could not write the dependencies. Check permissions for this user and the npm cache.'
            : 'Check npm registry connectivity, proxy configuration, available disk space, and permissions.';
    throw new CliError('DEPENDENCIES_FAILED', `Could not prepare the managed service dependencies with npm${code ? ` (${code})` : ''}.`, [
      action, 'The existing service has not been replaced.',
      'Correct the npm error recorded in the server log, then retry the installation.',
    ], { cause });
  }
}

export async function resolveServiceNpm(): Promise<string> {
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
    return candidate;
  }
  throw new CliError('NPM_UNAVAILABLE', 'npm could not be located.', ['Install Node.js with npm and run service install from that terminal.']);
}
