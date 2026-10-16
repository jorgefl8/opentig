import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './service-installation';
import { CliError, cliCommand, diagnostic, errorCode } from './cli-errors';
import { CliServerLog } from './cli-log';

interface StartupResult {
  attempt: string;
  phase: 'pending' | 'starting' | 'ready' | 'failed';
  requestedAt: string;
  pid?: number;
  instanceId?: string;
  code?: string;
  message?: string;
}
const file = (home: string) => path.join(home, 'service/startup.json');

export async function readStartup(home: string): Promise<StartupResult | null> {
  try {
    const value = JSON.parse(await readFile(file(home), 'utf8')) as StartupResult;
    return value && typeof value.attempt === 'string' && typeof value.requestedAt === 'string'
      && ['pending', 'starting', 'ready', 'failed'].includes(value.phase) ? value : null;
  } catch (error) { if (errorCode(error) === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

/** One private bounded record, replaced for each installation/restart attempt. */
export async function requestStartup(home: string): Promise<string> {
  const attempt = randomUUID();
  await atomicWrite(file(home), JSON.stringify({ attempt, requestedAt: new Date().toISOString(), phase: 'pending' }));
  return attempt;
}

export async function startupReporter(home: string) {
  if (!process.env.OPENTIG_SERVICE_HOME || path.resolve(process.env.OPENTIG_SERVICE_HOME) !== path.resolve(home)) return null;
  const previous = await readStartup(home);
  const result: StartupResult = previous?.phase === 'pending' ? previous
    : { attempt: randomUUID(), requestedAt: new Date().toISOString(), phase: 'pending' };
  const save = async (patch: Partial<StartupResult>, initial = false) => {
    const current = await readStartup(home);
    // An old process must never replace a newer requested attempt.
    if (current && current.attempt !== result.attempt && (!initial || current.attempt !== previous?.attempt)) return;
    await atomicWrite(file(home), JSON.stringify({ ...result, ...patch, pid: process.pid }));
  };
  await save({ phase: 'starting' }, true);
  return {
    ready: (instanceId: string) => save({ phase: 'ready', instanceId }),
    failed: (error: unknown) => save({ phase: 'failed', code: error instanceof CliError ? error.code : 'STARTUP_FAILED', message: diagnostic(error) }),
  };
}

export async function recordCliFailure(home: string, error: unknown): Promise<void> {
  const log = new CliServerLog(path.join(home, 'logs/server.log'));
  log.logger('error', diagnostic(error));
  // Operational errors retain causes locally, with the logger's secret redaction.
  let cause: unknown = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; cause && depth < 4; depth++) {
    log.logger('error', `Cause: ${cause instanceof Error ? cause.message : 'Unknown failure'}`);
    if (cause instanceof AggregateError) for (const item of cause.errors) log.logger('error', `Recovery detail: ${diagnostic(item)}`);
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  await log.close();
}

export function startupTimeout(home: string): CliError {
  return new CliError('STARTUP_TIMEOUT', 'The managed service did not become ready before the startup timeout.', [
    'The cause could not be determined automatically.', `Check: ${cliCommand(home, 'service', 'status')}`,
    `Server log: ${path.join(home, 'logs/server.log')}`,
    `Windows startup output: ${path.join(home, 'logs/service-stderr.log')}; on Linux/macOS inspect the user supervisor's logs.`,
  ]);
}
