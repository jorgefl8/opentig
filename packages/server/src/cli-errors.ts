import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSensitiveText } from '../../../src/shared/redaction';
import { OPEN_TIG_APP_VERSION } from './version';

/** Operational errors retain a stable identity independently of their wording. */
export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly actions: string[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
  }
}

/** npx runs from its cache without an `opentig` command on PATH; print a runnable form. */
export function cliInvocation(modulePath = fileURLToPath(import.meta.url)): string {
  return modulePath.split(/[\\/]/).includes('_npx') ? `npx -y @opentig/cli@${OPEN_TIG_APP_VERSION}` : 'opentig';
}

export function cliCommand(home: string, ...args: string[]): string {
  const quote = (value: string) => `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`;
  return `${cliInvocation()} ${args.map(arg => /^[a-zA-Z0-9_.:=/-]+$/.test(arg) ? arg : quote(arg)).join(' ')} --home ${quote(home)}`;
}

export function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

export function diagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return redactSensitiveText(error instanceof CliError ? `${message}\n${error.actions.join('\n')}`.trim() : message);
}

export function operationError(error: unknown, home: string, operation: string): CliError {
  if (error instanceof CliError) return error;
  const code = errorCode(error);
  const checks = [`Check: ${cliCommand(home, 'service', 'status')}`, `Server log: ${path.join(home, 'logs/server.log')}`];
  if (code === 'EACCES' || code === 'EPERM') return new CliError('PERMISSION_DENIED', `Cannot ${operation}: permission was denied.`, [
    `Check this user's access to ${home} and the user service manager. Organization policies may restrict service tasks.`,
    'Use your normal OS account; do not switch to a different account or run the server as administrator.',
  ], { cause: error });
  if (code === 'ENOSPC') return new CliError('DISK_FULL', `Cannot ${operation}: the disk is full.`, [`Free space on the volume containing ${home}, then retry.`], { cause: error });
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'UND_ERR_CONNECT_TIMEOUT'
    || error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message === 'fetch failed')) {
    return new CliError('CONNECTION_FAILED', `Cannot ${operation}: the server could not be reached or did not respond in time.`, checks, { cause: error });
  }
  return new CliError('OPERATION_FAILED', `Cannot ${operation}.`, ['The cause could not be determined automatically.', ...checks], { cause: error });
}

export function serviceError(error: unknown, home: string, action: string): CliError {
  if (error instanceof CliError) return error;
  const verb = action === 'status' ? 'inspect' : action;
  if (['EACCES', 'EPERM', 'ENOSPC'].includes(errorCode(error) ?? '')) return operationError(error, home, `${verb} the service`);
  return new CliError('SUPERVISOR_FAILED', `Could not ${verb} the OpenTig user service.`, [
    process.platform === 'win32' ? 'Check Task Scheduler access and organization policies for your Windows account.'
      : process.platform === 'darwin' ? 'Check the user LaunchAgent in an active macOS GUI login session.'
        : 'Check the systemd user manager in your login session.',
    `Check: ${cliCommand(home, 'service', 'status')}`,
    `Service startup output: ${path.join(home, 'logs/service-stderr.log')} (Windows), or the user supervisor's logs.`,
    'The requested operation may be incomplete. Inspect its state before retrying.',
  ], { cause: error });
}
