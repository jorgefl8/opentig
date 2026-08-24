import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '../../../src/shared/server-config';

export type OpenTigCliCommand = 'start' | 'serve' | 'pair' | 'service' | 'help' | 'version';
export type OpenTigServiceAction = 'install' | 'status' | 'uninstall';

export interface OpenTigCliConfig {
  command: OpenTigCliCommand;
  serviceAction: OpenTigServiceAction | null;
  cwd: string;
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
  let cwdValue: string | undefined;
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
    if (!optionsEnded && (argument === '--help' || argument === '-h')) return terminalConfig('help', currentDirectory, homeDirectory);
    if (!optionsEnded && (argument === '--version' || argument === '-v')) return terminalConfig('version', currentDirectory, homeDirectory);
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
    if (!commandSelected && cwdValue === undefined && isCommand(argument)) {
      command = argument;
      commandSelected = true;
      continue;
    }
    if (command === 'service' && serviceAction === null && isServiceAction(argument)) {
      serviceAction = argument;
      continue;
    }
    if (cwdValue !== undefined) throw new CliUsageError('Only one working directory may be supplied.');
    cwdValue = argument;
  }

  if (command === 'pair' && cwdValue !== undefined) throw new CliUsageError('The pair command does not accept a working directory.');
  if (command === 'pair' && (hostValue !== undefined || portValue !== undefined || noBrowser)) {
    throw new CliUsageError('The pair command only accepts --home.');
  }
  if (command === 'service' && serviceAction === null) throw new CliUsageError('The service command requires install, status, or uninstall.');
  if (command === 'service' && serviceAction !== 'install' && cwdValue !== undefined) {
    throw new CliUsageError(`The service ${serviceAction} command does not accept a working directory.`);
  }
  if (command === 'service' && serviceAction !== 'install' && (hostValue !== undefined || portValue !== undefined || noBrowser)) {
    throw new CliUsageError(`The service ${serviceAction} command only accepts --home.`);
  }

  if (command === 'pair') {
    return {
      command,
      serviceAction: null,
      cwd: path.resolve(currentDirectory),
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
  const cwd = resolvePath(cwdValue ?? currentDirectory, currentDirectory, 'working directory');

  return {
    command,
    serviceAction,
    cwd,
    host,
    port,
    home,
    openBrowser: command === 'start' && !noBrowser,
  };
}

export function cliHelp(version: string): string {
  return `OpenTig ${version}

Usage:
  opentig [cwd] [options]
  opentig start [cwd] [options]
  opentig serve [cwd] [options]
  opentig pair [--home <path>]
  opentig service <install|status|uninstall> [cwd] [options]

Commands:
  start       Start OpenTig and open the one-time pairing link (default)
  serve       Start OpenTig without opening a browser
  pair        Create a new one-time link for a running server
  service     Explicitly manage startup at boot (Linux/systemd)

Options:
  --host <host>       Listener host (default: ${DEFAULT_SERVER_HOST}; env: OPENTIG_HOST)
  --port <port>       Listener port (default: ${DEFAULT_SERVER_PORT}; env: OPENTIG_PORT)
  --home <path>       Data directory (default: ~/.opentig; env: OPENTIG_HOME)
  --no-browser        Do not open a browser in start mode
  -h, --help          Show help
  -v, --version       Show version

Node.js 24 or later and Git are required. Plain bunx launches this Node executable.`;
}

function terminalConfig(command: 'help' | 'version', cwd: string, home: string): OpenTigCliConfig {
  return {
    command,
    serviceAction: null,
    cwd: path.resolve(cwd),
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

function isCommand(value: string): value is 'start' | 'serve' | 'pair' | 'service' {
  return value === 'start' || value === 'serve' || value === 'pair' || value === 'service';
}

function isServiceAction(value: string): value is OpenTigServiceAction {
  return value === 'install' || value === 'status' || value === 'uninstall';
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
