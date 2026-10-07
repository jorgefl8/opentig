import { createHash } from 'node:crypto';
import os from 'node:os';
import { AUTOMATIC_GITHUB_ACCOUNT, type GitHubAccountsStatus, type GitHubAccountSelection, type GitHubRepositoryAccount } from '../../shared/github-accounts';
import { GhOperationError } from '../../shared/errors';
import type { RepositoryInfo } from '../../shared/contracts';
import type { CliCandidate, CliResolver } from '../ai/CliResolver';
import { selectCli, type CliDetection } from '../ai/cli-selection';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import type { GitProcess } from '../git/GitProcess';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { GitHubStatusStore } from '../persistence/GitHubStatusStore';
import { accountAuthentication, GH_ENV, GH_PRIVATE_ENV, identifySshAccount, type GitHubCommandAuth } from './GitHubAccountAuth';
import { GITHUB_LOGIN, parseGitHubAuthStatus } from './GitHubAuthStatusParser';
import { parseSshRemote } from './GitHubRemoteParser';

const CACHE_MS = 60_000;
const emptyStatus = (): GitHubAccountsStatus => ({ installationStatus: 'unchecked', accounts: [], activeLogin: null,
  environment: { present: false, login: null, state: 'unknown' }, checkedAt: null });

export class GitHubAccountsService {
  private inventory: GitHubAccountsStatus | null = null;
  private loading: Promise<GitHubAccountsStatus> | null = null;
  private checking: Promise<GitHubAccountsStatus> | null = null;
  private detection: { at: number; promise: Promise<CliDetection> } | null = null;
  private revision = 0;
  get authRevision(): number { return this.revision; }
  private contexts = new Map<string, { remote: string; value: GitHubRepositoryAccount }>();
  private ssh = new Map<string, { at: number; promise: Promise<string | null> }>();
  private identities = new Map<string, { at: number; promise: Promise<string> }>();

  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner,
    private readonly git: GitProcess, private readonly settings?: SettingsStore, private readonly store?: GitHubStatusStore,
    private readonly changed: () => void = () => undefined) {}

  status(force = false): Promise<GitHubAccountsStatus> {
    if (force) {
      this.checking ??= this.check().finally(() => { this.checking = null; });
      return this.checking.then((value) => structuredClone(value));
    }
    this.loading ??= (async () => { this.inventory ??= await this.store?.load() ?? emptyStatus(); return this.inventory; })();
    return this.loading.then(() => structuredClone(this.inventory ?? emptyStatus()));
  }

  selection(repository: RepositoryInfo): GitHubAccountSelection {
    return this.settings?.githubAccount(repository.commonDir) ?? { ...AUTOMATIC_GITHUB_ACCOUNT };
  }

  context(repository: RepositoryInfo, remote: string, nameWithOwner: string | null): GitHubRepositoryAccount {
    const cached = this.contexts.get(repository.id);
    if (cached?.remote === remote && cached.value.revision === this.revision) return structuredClone(cached.value);
    const selection = this.selection(repository);
    return { selection, nameWithOwner, login: selection.mode === 'account' ? selection.login : null,
      source: selection.mode === 'account' ? 'explicit' : null, state: 'unchecked', checkedAt: null, revision: this.revision };
  }

  async setSelection(repository: RepositoryInfo, selection: GitHubAccountSelection): Promise<void> {
    if (!this.settings) throw new Error('GitHub account settings are unavailable.');
    await this.settings.setGitHubAccount(repository.commonDir, selection);
    this.invalidate();
  }

  private invalidate(): void {
    this.revision++;
    this.contexts.clear();
    this.ssh.clear();
    this.identities.clear();
    this.changed();
  }

  refreshAuthentication(): void {
    this.ssh.clear();
    this.identities.clear();
  }

  async detect(force = false): Promise<CliDetection> {
    if (force || !this.detection || Date.now() - this.detection.at > CACHE_MS) {
      this.detection = { at: Date.now(), promise: selectCli(this.resolver, this.runner, 'gh', { forceRefresh: force,
        runOptions: { cwd: os.homedir(), env: { ...GH_ENV }, removeEnv: ['GH_DEBUG', 'DEBUG'] } }) };
    }
    return this.detection.promise;
  }

  async authenticate(repository: RepositoryInfo, remote: string, nameWithOwner: string, operation: string) {
    const revision = this.revision;
    const selection = this.selection(repository);
    let login: string | null = selection.mode === 'account' ? selection.login : null;
    let source: GitHubRepositoryAccount['source'] = selection.mode === 'account' ? 'explicit' : null;
    try {
      const detection = await this.detect();
      if (detection.state !== 'available' || !detection.candidate) throw new GhOperationError({ code: detection.state === 'not-found' ? 'GH_CLI_NOT_FOUND' : 'GH_PROCESS_FAILED', operation,
        message: detection.state === 'not-found' ? 'GitHub CLI is not installed on the backend host.' : 'GitHub CLI could not run. Check Settings → GitHub.' });
      const executable = detection.candidate;
      if (selection.mode === 'auto' && parseSshRemote(remote)) {
        const override = executable.env.GIT_SSH_COMMAND || executable.env.GIT_SSH || process.env.GIT_SSH_COMMAND || process.env.GIT_SSH;
        const configured = await this.git.run(repository.path, ['config', '--default', '', '--get', 'core.sshCommand'], {
          operation: 'github-ssh-configuration', readOnly: true, maxOutputBytes: 8 * 1024,
        });
        if (override || configured.stdout.toString('utf8').trim()) throw new GhOperationError({ code: 'GH_ACCOUNT_UNRESOLVED', operation,
          message: 'This repository uses a custom SSH command. Choose an explicit account in Settings → GitHub.' });
        const key = `${repository.path}\0${remote}`;
        let cached = this.ssh.get(key);
        if (!cached || Date.now() - cached.at > CACHE_MS) {
          cached = { at: Date.now(), promise: identifySshAccount(remote, this.runner) };
          this.ssh.set(key, cached);
        }
        login = await cached.promise;
        source = 'ssh';
        if (!login) throw new GhOperationError({ code: 'GH_ACCOUNT_UNRESOLVED', operation,
          message: 'SSH could not verify a GitHub user account. Check again or choose an explicit account in Settings → GitHub. Deploy keys do not identify user accounts.' });
      }
      if (!source) source = executable.env.GH_TOKEN || executable.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? 'environment' : 'global';
      const auth = await accountAuthentication(login, executable, this.runner, operation);
      const verified = await this.identity(executable, auth, operation);
      if (login && login.toLowerCase() !== verified.toLowerCase()) throw new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation,
        message: `The saved credentials for @${login} authenticate a different account. Authenticate @${login} again and check Settings → GitHub.` });
      login = verified;
      const context: GitHubRepositoryAccount = { selection, nameWithOwner, login, source, state: 'ready', checkedAt: new Date().toISOString(), revision };
      if (revision === this.revision) {
        const previous = this.contexts.get(repository.id)?.value;
        if (previous?.state === 'ready' && (previous.login?.toLowerCase() !== login.toLowerCase() || previous.source !== source)) {
          // External gh/SSH changes discovered by any operation invalidate old-account reads.
          this.invalidate();
          context.revision = this.revision;
        }
        this.contexts.set(repository.id, { remote, value: context });
      }
      return { auth, executable, context };
    } catch (error) {
      const message = error instanceof GhOperationError ? error.message : 'Could not inspect GitHub authentication. Check Settings → GitHub again.';
      if (revision === this.revision) this.contexts.set(repository.id, { remote, value: { selection, nameWithOwner, login, source,
        state: 'error', checkedAt: new Date().toISOString(), message, revision } });
      if (error instanceof GhOperationError) throw error;
      throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message, retryable: true });
    }
  }

  private identity(executable: CliCandidate, auth: GitHubCommandAuth, operation: string): Promise<string> {
    // Only a one-way credential fingerprint is retained; tokens live in the operation's context.
    const fingerprint = createHash('sha256').update(auth.env?.GH_TOKEN ?? '').digest('hex');
    let cached = this.identities.get(fingerprint);
    if (!cached || Date.now() - cached.at > CACHE_MS) {
      const promise = (async () => {
        const result = await this.runner.run(executable.executable, ['api', 'user', '--jq', '.login'], {
          cwd: os.homedir(), env: { ...executable.env, ...GH_ENV, ...auth.env }, ...(auth.removeEnv ? { removeEnv: auth.removeEnv } : {}),
          timeoutMs: 15_000, maxOutputBytes: 8 * 1024,
        });
        const login = result.stdout.trim();
        if (result.exitCode === 0 && GITHUB_LOGIN.test(login)) return login;
        const invalid = /401|bad credentials|requires authentication/i.test(result.stderr);
        throw new GhOperationError({ code: invalid ? 'GH_AUTH_REQUIRED' : 'GH_PROCESS_FAILED', operation,
          message: invalid ? 'GitHub rejected these credentials. They may be expired or revoked. Authenticate this account again and check Settings → GitHub.'
            : 'Could not verify this GitHub account. Check your connection and try again.', retryable: !invalid });
      })();
      cached = { at: Date.now(), promise };
      this.identities.set(fingerprint, cached);
      void promise.catch(() => { if (this.identities.get(fingerprint)?.promise === promise) this.identities.delete(fingerprint); });
    }
    return cached.promise;
  }

  private async check(): Promise<GitHubAccountsStatus> {
    await this.status();
    this.refreshAuthentication();
    const checkedAt = new Date().toISOString();
    const detection = await this.detect(true);
    const result: GitHubAccountsStatus = { ...emptyStatus(), installationStatus: detection.state, checkedAt,
      ...(detection.version ? { version: detection.version } : {}) };
    if (detection.state === 'available' && detection.candidate) {
      const executable = detection.candidate;
      try {
        const status = await this.runner.run(executable.executable, ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts'], {
          cwd: os.homedir(), env: { ...executable.env, ...GH_ENV }, removeEnv: ['GH_TOKEN', ...GH_PRIVATE_ENV],
          timeoutMs: 60_000, maxOutputBytes: 256 * 1024,
        });
        if (status.exitCode !== 0) {
          if (/unknown flag.*json/i.test(status.stderr)) result.installationStatus = 'incompatible';
          throw new Error('Status failed');
        }
        Object.assign(result, parseGitHubAuthStatus(status.stdout));
        const envToken = executable.env.GH_TOKEN || executable.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
        if (envToken) {
          result.environment.present = true;
          try {
            const auth = await accountAuthentication(null, executable, this.runner, 'gh-auth-status');
            result.environment.login = await this.identity(executable, auth, 'gh-auth-status');
            result.environment.state = 'authenticated';
          } catch (error) { result.environment.state = error instanceof GhOperationError && error.detail.code === 'GH_AUTH_REQUIRED' ? 'invalid' : 'unknown'; }
        }
      } catch {
        result.message = result.installationStatus === 'incompatible'
          ? 'Update GitHub CLI to a version supporting auth status --json and multiple accounts.'
          : 'Could not check the saved GitHub accounts. Check your connection and CLI configuration, then try again.';
        // Failed checks must not erase the last successful account inventory.
        result.accounts = this.inventory?.accounts.map((account) => ({ ...account, state: 'unknown' as const })) ?? [];
        result.activeLogin = this.inventory?.activeLogin ?? null;
      }
    } else result.message = detection.state === 'not-found' ? 'Install GitHub CLI on the backend host.' : 'GitHub CLI was found but could not run. Check its installation and dependencies.';
    this.inventory = result;
    try { await this.store?.save(result); }
    finally { this.invalidate(); }
    return result;
  }
}
