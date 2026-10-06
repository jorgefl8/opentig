import os from 'node:os';
import { GhOperationError } from '../../shared/errors';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import type { CliCandidate } from '../ai/CliResolver';
import { parseSshRemote } from './GitHubRemoteParser';

export interface GitHubCommandAuth {
  env?: Record<string, string>;
  removeEnv?: string[];
}

/** Match a GitHub SSH identity without switching gh's global active account. */
export async function pullRequestAuthentication(
  remote: string, executable: CliCandidate, runner: CliProcessRunner,
): Promise<GitHubCommandAuth> {
  const ssh = parseSshRemote(remote);
  if (!ssh) return {};
  let login: string | undefined;
  try {
    const result = await runner.run('ssh', [
      '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'RemoteCommand=none',
      ...(ssh.port ? ['-p', ssh.port] : []), '--', ssh.destination,
    ], { cwd: os.homedir(), timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
    // GitHub deliberately exits with 1 after successful SSH authentication.
    if (result.exitCode === 0 || result.exitCode === 1) {
      login = /^Hi ([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)! You've successfully authenticated, but GitHub does not provide shell access\.\s*$/m
        .exec(`${result.stdout}\n${result.stderr}`)?.[1];
    }
  } catch { /* Unavailable SSH inspection must not break an existing gh workflow. */ }
  if (!login) return {};

  // Ask gh to read its own credential store. The token stays in memory and is
  // supplied only to this command's child process, never arguments or files.
  const removeEnv = ['GH_TOKEN', 'GITHUB_TOKEN'];
  try {
    const result = await runner.run(executable.executable, ['auth', 'token', '--hostname', 'github.com', '--user', login], {
      cwd: os.homedir(), env: { ...executable.env, GH_PROMPT_DISABLED: '1' }, removeEnv,
      timeoutMs: 10_000, maxOutputBytes: 8 * 1024,
    });
    const token = result.stdout.trim();
    if (result.exitCode === 0 && /^[A-Za-z0-9_]{20,4096}$/.test(token)) {
      return { env: { GH_TOKEN: token }, removeEnv: ['GITHUB_TOKEN'] };
    }
  } catch { /* Never surface credential command output or errors. */ }
  throw new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation: 'gh-pr-create',
    message: `The SSH remote authenticates as ${login}, but GitHub CLI has no usable saved token for that account. Run gh auth login --hostname github.com and sign in as ${login}, then retry. SSH authentication and GitHub CLI login are separate.` });
}

export function redactCommandToken(value: string, auth: GitHubCommandAuth): string {
  const token = auth.env?.GH_TOKEN;
  return token ? value.split(token).join('[redacted]') : value;
}
