import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { CliUsageError, parseCliArguments } from './cli-config';
import { newerVersion, packageDirectory, readInstallation } from './service-installation';
import { OPEN_TIG_APP_VERSION } from './version';
import { CliError, cliCommand } from './cli-errors';

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
  let installed;
  try { installed = await readInstallation(config.home); }
  catch (error) {
    if (config.command === 'help' || config.command === 'version') return null;
    throw error;
  }
  if (!installed || !newerVersion(installed.version, OPEN_TIG_APP_VERSION)) return null;
  if (config.command === 'version') {
    process.stdout.write(`OpenTig service ${installed.version}\nGlobal launcher ${OPEN_TIG_APP_VERSION}\n`);
    return 0;
  }
  const entry = path.join(packageDirectory(config.home, installed), 'dist/bin.mjs');
  try { if (await realpath(entry) === await realpath(currentEntry)) return null; }
  catch (cause) {
    if (config.command === 'help') return null;
    throw new CliError('SERVICE_LAUNCHER_MISSING', 'Could not locate the newer managed service executable.', [
      `Check ${entry} and restore the managed service files.`,
      `Install a global CLI matching service version ${installed.version} before repairing this home.`,
      `Inspect: ${cliCommand(config.home, 'service', 'status')}`,
    ], { cause });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', env: { ...process.env, OPENTIG_DELEGATED: '1' } });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const clean = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('error', (cause) => { clean(); reject(new CliError('SERVICE_LAUNCH_FAILED', 'Could not launch the newer managed service CLI.', [`Check the Node executable and file permissions for ${entry}.`], { cause })); });
    child.once('exit', (code, signal) => { clean(); resolve(code ?? (signal === 'SIGINT' ? 130 : 143)); });
  });
}
