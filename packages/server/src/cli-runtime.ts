import { execFile } from 'node:child_process';
import path from 'node:path';
import { CliError, cliCommand } from './cli-errors';
import { readAdminToken, readRuntimeState, resolveCliPaths, type OpenTigRuntimeState } from './cli-home';

export function publicOrigin(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  return `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}`;
}
export function isProcessRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** The admin endpoint proves the listener owns both this home's token and instance ID. */
export async function probeRuntime(home: string, runtime?: OpenTigRuntimeState, allowLegacy = false): Promise<OpenTigRuntimeState & { legacy?: boolean }> {
  const paths = resolveCliPaths(home);
  const state = runtime ?? await readRuntimeState(paths.runtimeState);
  if (!isProcessRunning(state.pid)) throw new CliError('RUNTIME_STALE', 'OpenTig runtime state is stale; its process is not running.', [
    `Start this instance: ${cliCommand(home, 'serve')}`, `Or restart its service: ${cliCommand(home, 'service', 'restart')}`,
  ]);
  const token = await readAdminToken(paths.adminToken).catch(cause => { throw new CliError('ADMIN_CREDENTIAL_INVALID', 'OpenTig local admin credential is missing or unreadable.', [`Check the private credential and permissions in ${paths.serverData}; do not delete the home or copy another instance's credential.`], { cause }); });
  const response = await fetch(`${publicOrigin(state.host, state.port)}/api/admin/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OpenTig-Admin': token },
    body: JSON.stringify({ instanceId: state.instanceId }), signal: AbortSignal.timeout(1000),
  });
  if (response.status === 404 && allowLegacy) {
    // Older CLIs have no status endpoint. An intentionally invalid origin checks
    // existing admin authentication/instance validation without creating a token.
    const check = await fetch(`${publicOrigin(state.host, state.port)}/api/admin/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OpenTig-Admin': token },
      body: JSON.stringify({ instanceId: state.instanceId, publicOrigin: 'invalid-origin' }), signal: AbortSignal.timeout(1000),
    });
    if (check.status === 400 && (await check.json() as { error?: string }).error === 'Invalid public origin.') {
      const ready = await fetch(`${publicOrigin(state.host, state.port)}/readyz`, { signal: AbortSignal.timeout(1000) });
      const identity = await ready.json() as { status?: string; appVersion?: string; protocolVersion?: number };
      if (ready.ok && identity.status === 'ready' && identity.appVersion === state.appVersion && identity.protocolVersion === state.protocolVersion) return { ...state, legacy: true };
    }
  }
  if (!response.ok) throw new CliError('RUNTIME_MISMATCH', 'OpenTig runtime state does not match the running server.', [
    `Inspect this instance: ${cliCommand(home, 'service', 'status')}`, 'Do not stop an unknown process or remove credentials to work around an identity mismatch.',
  ]);
  const identity = await response.json() as { instanceId?: string; pid?: number; appVersion?: string; protocolVersion?: number; status?: string };
  if (identity.instanceId !== state.instanceId || identity.pid !== state.pid || identity.appVersion !== state.appVersion || identity.protocolVersion !== state.protocolVersion || identity.status !== 'ready') {
    throw new CliError('RUNTIME_MISMATCH', 'The running server identity or readiness does not match this home.', [`Check ${path.join(home, 'logs/server.log')} before restarting this instance.`]);
  }
  return state;
}

export function assertGitAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim().startsWith('git version ')) reject(new CliError('GIT_UNAVAILABLE', 'Git is required and could not be executed from PATH.', [
        'Install Git or correct PATH in this terminal, then retry.',
        'If tool locations changed, reinstall the service from this terminal to capture the updated PATH.',
      ], { cause: error }));
      else resolve();
    });
  });
}
