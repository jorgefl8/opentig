import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { CliUsageError, parseCliArguments } from './cli-config';
import { newerVersion, packageDirectory, readInstallation } from './service-installation';
import { OPEN_TIG_APP_VERSION } from './version';

/** A global CLI remains a launcher after the managed service updates itself. */
export async function delegateToService(args: string[], currentEntry: string): Promise<number | null> {
  if (process.env.OPENTIG_DELEGATED === '1') return null;
  let config;
  try { config = parseCliArguments(args); }
  catch (error) {
    // Let the regular CLI retain its usage message and exit code for bad arguments.
    if (error instanceof CliUsageError) return null;
    throw error;
  }
  if (config.command === 'help' || config.command === 'version') {
    const index = args.findIndex((arg) => arg === '--home' || arg.startsWith('--home='));
    const home = index >= 0 ? (args[index] === '--home' ? args[index + 1] : args[index]!.slice(7)) : process.env.OPENTIG_HOME;
    if (home) config.home = path.resolve(home);
  }
  const installed = await readInstallation(config.home);
  if (!installed || !newerVersion(installed.version, OPEN_TIG_APP_VERSION)) return null;
  const entry = path.join(packageDirectory(config.home, installed), 'dist/bin.mjs');
  if (await realpath(entry) === await realpath(currentEntry)) return null;
  if (config.command === 'version') {
    process.stdout.write(`OpenTig service ${installed.version}\nGlobal launcher ${OPEN_TIG_APP_VERSION}\n`);
    return 0;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', env: { ...process.env, OPENTIG_DELEGATED: '1' } });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const clean = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', (error) => { clean(); reject(error); });
    child.once('exit', (code, signal) => { clean(); resolve(code ?? (signal === 'SIGINT' ? 130 : 143)); });
  });
}
