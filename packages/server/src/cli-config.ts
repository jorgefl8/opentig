import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '../../../src/shared/server-config';

export type OpenTigCliCommand = 'start' | 'serve' | 'pair' | 'service' | 'help' | 'version';
export type OpenTigServiceAction = 'install' | 'status' | 'restart' | 'uninstall';

export interface OpenTigCliConfig {
  command: OpenTigCliCommand;
  serviceAction: OpenTigServiceAction | null;
  host: string;
  port: number;
  home: string;
  openBrowser: boolean;
}

export class CliUsageError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export function parseCliArguments(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  currentDirectory = process.cwd(),
  homeDirectory = os.homedir(),
): OpenTigCliConfig {
  let command: OpenTigCliCommand = 'start';
  let commandSelected = false;
  let serviceAction: OpenTigServiceAction | null = null;
  let hostValue: string | undefined;
  let portValue: string | undefined;
  let homeValue: string | undefined;
  let noBrowser = false;
  let optionsEnded = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!optionsEnded && argument === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && (argument === '--help' || argument === '-h')) return terminalConfig('help', homeDirectory);
    if (!optionsEnded && (argument === '--version' || argument === '-v')) return terminalConfig('version', homeDirectory);
    if (!optionsEnded && argument === '--no-browser') {
      noBrowser = true;
      continue;
    }
    if (!optionsEnded && argument.startsWith('--')) {
      const [name, inline] = splitOption(argument);
      const value = inline ?? args[++index];
      if (value === undefined || value.startsWith('--')) throw new CliUsageError(`Missing value for ${name}.`);
      if (name === '--host') hostValue = value;
      else if (name === '--port') portValue = value;
      else if (name === '--home') homeValue = value;
      else throw new CliUsageError(`Unknown option: ${name}.`);
      continue;
    }
    if (!commandSelected && isCommand(argument)) {
      if (argument === 'help' || argument === 'version') {
        return terminalConfig(argument, homeDirectory);
      }
      command = argument;
      commandSelected = true;
      continue;
    }
    if (command === 'service' && serviceAction === null && isServiceAction(argument)) {
      serviceAction = argument;
      continue;
    }
    throw new CliUsageError(`Unexpected argument: ${argument}. Add and select repositories from the OpenTig web UI.`);
  }

  if (command === 'pair' && (hostValue !== undefined || portValue !== undefined || noBrowser)) {
    throw new CliUsageError('The pair command only accepts --home.');
  }
  if (command === 'service' && serviceAction === null) throw new CliUsageError('The service command requires install, status, restart, or uninstall.');
  if (command === 'service' && serviceAction !== 'install' && (hostValue !== undefined || portValue !== undefined || noBrowser)) {
    throw new CliUsageError(`The service ${serviceAction} command only accepts --home.`);
  }

  if (command === 'pair') {
    return {
      command,
      serviceAction: null,
      host: DEFAULT_SERVER_HOST,
      port: DEFAULT_SERVER_PORT,
      home: resolvePath(homeValue ?? environment.OPENTIG_HOME ?? path.join(homeDirectory, '.opentig'), currentDirectory, 'home'),
      openBrowser: false,
    };
  }

  const host = validateHost(hostValue ?? environment.OPENTIG_HOST ?? DEFAULT_SERVER_HOST);
  const environmentPort = environment.OPENTIG_PORT;
  const port = validatePort(portValue ?? environmentPort ?? String(DEFAULT_SERVER_PORT));
  const home = resolvePath(homeValue ?? environment.OPENTIG_HOME ?? path.join(homeDirectory, '.opentig'), currentDirectory, 'home');

  return {
    command,
    serviceAction,
    host,
    port,
    home,
    openBrowser: command === 'start' && !noBrowser,
  };
}

export function cliHelp(version: string): string {
  return `OpenTig ${version}

Usage:
  opentig [options]
  opentig start [options]
  opentig serve [options]
  opentig pair [--home <path>]
  opentig service <install|status|restart|uninstall> [options]
  opentig help
  opentig version

Commands:
  start       Start OpenTig and open the one-use pairing link (default)
  serve       Start OpenTig without opening a browser; ideal for servers
  pair        Print a fresh five-minute code/link for a running server
  service     Manage a background server (Linux, macOS, Windows)
  help        Show this help
  version     Show the OpenTig version

Options:
  --host <host>       Listener host (default: ${DEFAULT_SERVER_HOST}; env: OPENTIG_HOST)
  --port <port>       Listener port (default: ${DEFAULT_SERVER_PORT}; env: OPENTIG_PORT)
  --home <path>       Data directory (default: ~/.opentig; env: OPENTIG_HOME)
  --no-browser        Do not open a browser in start mode
  -h, --help          Show help
  -v, --version       Show version

Examples:
  opentig start
  opentig serve
  opentig serve --host 127.0.0.1 --port 6767
  opentig pair --home ~/.opentig
  opentig service install --host 127.0.0.1 --port 6767
  opentig service status

Repositories:
  Add, open, and switch server-side Git repositories from the web UI. The CLI
  starts one OpenTig instance and is never scoped to a project directory.

Pairing and remote access:
  Every browser needs the printed five-minute, one-use code. Open the printed
  link, or open https://your-domain.example/pair and paste the code there.
  A same-machine HTTPS tunnel can point directly to http://127.0.0.1:6767;
  no public URL needs to be registered in OpenTig. Use --host 0.0.0.0 only for
  a trusted LAN/VPN; pairing is still required.

Runtime behavior:
  The configured port is never changed silently. If it is occupied, OpenTig
  exits and asks you to stop that process or choose another --port. SIGINT and
  SIGTERM shut the server down cleanly. npx and bunx never install a service;
  service installation is explicit. Linux uses systemd with lingering; macOS
  and Windows start at login and stop at logout.

Requirements: Node.js 24 or later and Git. Plain bunx launches the Node shebang;
running OpenTig with the Bun runtime itself is not supported.`;
}

function terminalConfig(command: 'help' | 'version', home: string): OpenTigCliConfig {
  return {
    command,
    serviceAction: null,
    host: DEFAULT_SERVER_HOST,
    port: DEFAULT_SERVER_PORT,
    home: path.resolve(home, '.opentig'),
    openBrowser: false,
  };
}

function splitOption(argument: string): [string, string | undefined] {
  const separator = argument.indexOf('=');
  return separator < 0
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

function isCommand(value: string): value is OpenTigCliCommand {
  return value === 'start' || value === 'serve' || value === 'pair' || value === 'service' || value === 'help' || value === 'version';
}

function isServiceAction(value: string): value is OpenTigServiceAction {
  return value === 'install' || value === 'status' || value === 'restart' || value === 'uninstall';
}

function validateHost(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || /[\s/?#@\\]/.test(normalized)) throw new CliUsageError('Invalid host.');
  return normalized;
}

function validatePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new CliUsageError('Port must be an integer between 1 and 65535.');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new CliUsageError('Port must be an integer between 1 and 65535.');
  return port;
}

function resolvePath(value: string, currentDirectory: string, label: string): string {
  if (!value || value.includes('\0')) throw new CliUsageError(`Invalid ${label}.`);
  return path.resolve(currentDirectory, value);
}
