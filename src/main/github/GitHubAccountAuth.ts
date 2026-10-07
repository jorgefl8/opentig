import os from 'node:os';
import { GhOperationError } from '../../shared/errors';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import type { CliCandidate } from '../ai/CliResolver';
import { parseSshRemote } from './GitHubRemoteParser';
import { GITHUB_LOGIN } from './GitHubAuthStatusParser';

export interface GitHubCommandAuth {
  env?: Record<string, string>;
  removeEnv?: string[];
}

export const GH_ENV = { GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PAGER: 'cat', NO_COLOR: '1' } as const;
export const GH_PRIVATE_ENV = ['GITHUB_TOKEN', 'GH_DEBUG', 'DEBUG'];

/** Match the server's authenticated identity, never the owner or SSH alias. */
export async function identifySshAccount(remote: string, runner: CliProcessRunner): Promise<string | null> {
  const ssh = parseSshRemote(remote);
  if (!ssh) return null;
  try {
    const config = await runner.run('ssh', ['-G', ...(ssh.port ? ['-p', ssh.port] : []), '--', ssh.destination], {
      cwd: os.homedir(), timeoutMs: 5_000, maxOutputBytes: 64 * 1024,
    });
    const hostname = config.stdout.split(/\r?\n/).find((line) => /^hostname\s/i.test(line))?.trim().split(/\s+/)[1];
    if (config.exitCode !== 0 || hostname?.toLowerCase() !== 'github.com') return null;
    const result = await runner.run('ssh', [
      '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'RemoteCommand=none', '-o', 'UpdateHostKeys=no',
      ...(ssh.port ? ['-p', ssh.port] : []), '--', ssh.destination,
    ], { cwd: os.homedir(), timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
    // GitHub deliberately exits with 1 after successful authentication.
    if (result.exitCode !== 0 && result.exitCode !== 1) return null;
    const login = /^Hi ([A-Za-z0-9-]+)! You've successfully authenticated, but GitHub does not provide shell access\.\s*$/m
      .exec(`${result.stdout}\n${result.stderr}`)?.[1];
    return login && GITHUB_LOGIN.test(login) ? login : null;
  } catch { return null; }
}

/** Only the child receives this token. Credential-command output never becomes an error. */
export async function accountAuthentication(login: string | null, executable: CliCandidate, runner: CliProcessRunner, operation: string): Promise<GitHubCommandAuth> {
  try {
    const result = await runner.run(executable.executable, ['auth', 'token', '--hostname', 'github.com', ...(login ? ['--user', login] : [])], {
      cwd: os.homedir(), env: { ...executable.env, ...GH_ENV },
      removeEnv: login ? ['GH_TOKEN', ...GH_PRIVATE_ENV] : ['GH_DEBUG', 'DEBUG'], timeoutMs: 10_000, maxOutputBytes: 8 * 1024,
    });
    const token = result.stdout.trim();
    if (result.exitCode === 0 && /^[A-Za-z0-9_]{20,4096}$/.test(token)) return { env: { GH_TOKEN: token }, removeEnv: GH_PRIVATE_ENV };
    if (/unknown flag.*user/i.test(result.stderr)) throw new GhOperationError({ code: 'GH_CLI_INCOMPATIBLE', operation,
      message: 'Update GitHub CLI to a version supporting multiple accounts and auth token --user.' });
  } catch (error) {
    if (error instanceof GhOperationError) throw error;
    // Never surface credential command output or exceptions.
  }
  throw new GhOperationError({ code: login ? 'GH_ACCOUNT_MISSING' : 'GH_AUTH_REQUIRED', operation,
    message: login
      ? `GitHub CLI has no usable saved credentials for @${login}. Sign in as ${login} on the backend host and check Settings → GitHub again. SSH and GitHub CLI authentication are separate.`
      : 'GitHub CLI has no usable credentials. Sign in on the backend host and check Settings → GitHub again.' });
}

export function redactCommandToken(value: string, auth: GitHubCommandAuth): string {
  const token = auth.env?.GH_TOKEN;
  return token ? value.split(token).join('[redacted]') : value;
}
