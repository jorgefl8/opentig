import { lookup } from 'node:dns/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { CliError, cliCommand, errorCode } from './cli-errors';
import { loadStartupNetwork, type NetworkConfig } from './network-settings';
import type { OpenTigCliConfig } from './cli-config';

export async function cliNetwork(config: Pick<OpenTigCliConfig, 'home' | 'host' | 'port'>): Promise<NetworkConfig & { savedListener: boolean }> {
  try {
    const { network, savedListener } = await loadStartupNetwork({ settingsPath: path.join(config.home, 'settings.json'), serverDataPath: path.join(config.home, 'server'),
      mode: 'web-access', host: config.host, port: config.port });
    return { ...network, savedListener };
  } catch (cause) {
    throw new CliError('ACCESS_SETTINGS_INVALID', 'Could not load the saved web access settings.', [
      `Check ${path.join(config.home, 'server/web-access.json')} and its permissions.`,
      `To restore startup address and browser access, run ${cliCommand(config.home, 'reset-access')} and restart this instance.`,
      'Resetting access preserves paired browsers but removes the saved listener and access switches.',
    ], { cause });
  }
}

export function listenerError(error: unknown, config: Pick<OpenTigCliConfig, 'home' | 'host' | 'port'>, network: NetworkConfig & { savedListener?: boolean }, command: string): unknown {
  const code = errorCode(error);
  const address = `${network.listenerHost.includes(':') ? `[${network.listenerHost}]` : network.listenerHost}:${network.listenerPort}`;
  const saved = network.savedListener || network.listenerHost !== config.host || network.listenerPort !== config.port;
  const context = saved ? ['This address is affected by saved Settings → Web access. Saved listener fields override the corresponding startup options.',
    'Change the saved listener in that instance before retrying. If access recovery is needed:',
    `${cliCommand(config.home, 'reset-access')} removes saved access switches and listener; restart with the desired options.`]
    : ['Listener selected by startup options, OPENTIG_HOST/OPENTIG_PORT, or defaults.',
      `Choose another port, for example: ${cliCommand(config.home, ...command.split(' '), '--host', config.host, '--port', String(network.listenerPort === 65535 ? 6767 : network.listenerPort + 1))}`,
      'The example port has not been checked for availability.'];
  if (code === 'EADDRINUSE') return new CliError('PORT_IN_USE', `Port ${network.listenerPort} is already in use (${address}); cannot run ${command}.`, [
    'OpenTig Desktop or another process may be using this address. Close it and retry, or use a different port.', ...context,
    'No other application was stopped.',
  ], { cause: error });
  if (code === 'EADDRNOTAVAIL' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new CliError('HOST_UNAVAILABLE', `Cannot listen on ${address}: this host is not available on this machine.`, [
    'Use a local listening address, such as 127.0.0.1 for access from this computer.', ...context,
  ], { cause: error });
  if (code === 'EACCES' || code === 'EPERM') return new CliError('LISTENER_PERMISSION_DENIED', `Permission denied when listening on ${address}.`, [
    'Check OS port restrictions and choose an allowed port. Do not run the server as administrator.', ...context,
  ], { cause: error });
  return error;
}

/** Same bind semantics as OpenTigServer; advisory only, the real bind still handles races. */
export async function assertListenerAvailable(config: Pick<OpenTigCliConfig, 'home' | 'host' | 'port'>, network: NetworkConfig & { savedListener?: boolean }, command: string): Promise<void> {
  const socket = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.listen(network.listenerPort, network.listenerHost, resolve);
    });
  } catch (error) { throw listenerError(error, config, network, command); }
  finally { if (socket.listening) await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve())); }
}

export async function sameListener(network: NetworkConfig, runtime: { host: string; port: number }): Promise<boolean> {
  if (network.listenerPort !== runtime.port) return false;
  if (network.listenerHost === runtime.host) return true;
  try { return (await lookup(network.listenerHost)).address === runtime.host; }
  catch { return false; }
}
