import { createHash } from 'node:crypto';
import os from 'node:os';
import { DEFAULT_GITHUB_ACCOUNT, githubRepositoryKey, resolveGitHubAccount, type GitHubAccountDetection, type GitHubAccountSource, type GitHubAccountsStatus, type GitHubAccountSelection, type GitHubRepositoryAccount } from '../../shared/github-accounts';
import { GhOperationError } from '../../shared/errors';
import type { RepositoryInfo } from '../../shared/contracts';
import type { CliCandidate, CliResolver } from '../ai/CliResolver';
import { selectCli, type CliDetection } from '../ai/cli-selection';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import type { GitProcess } from '../git/GitProcess';
import type { SettingsStore } from '../persistence/SettingsStore';
import type { GitHubStatusStore } from '../persistence/GitHubStatusStore';
import { accountAuthentication, GH_ENV, GH_PRIVATE_ENV, identifySshAccount, redactCommandToken, type GitHubCommandAuth } from './GitHubAccountAuth';
import { GITHUB_LOGIN, parseGitHubAuthStatus } from './GitHubAuthStatusParser';
import { classifyFailure } from './GitHubFailure';
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
  private readonly revisions = new Map<string, number>();
  private defaultRevision = 0;
  revisionFor(repository: RepositoryInfo): number {
    const selection = this.selection(repository);
    return Math.max(this.revisions.get(githubRepositoryKey(repository.commonDir)) ?? 0,
      selection.mode === 'default' ? this.defaultRevision : 0);
  }
  private contexts = new Map<string, { remote: string; value: GitHubRepositoryAccount }>();
  private ssh = new Map<string, { at: number; promise: Promise<string | null> }>();
  private identities = new Map<string, { at: number; promise: Promise<string> }>();
  private access = new Map<string, { at: number; promise: Promise<Array<{ login: string; push: boolean }>> }>();

  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner,
    private readonly git: GitProcess, private readonly settings?: SettingsStore, private readonly store?: GitHubStatusStore,
    private readonly changed: (repository?: RepositoryInfo, defaultOnly?: boolean, detected?: GitHubAccountDetection) => void = () => undefined) {}

  status(force = false): Promise<GitHubAccountsStatus> {
    if (force) {
      this.checking ??= this.check().finally(() => { this.checking = null; });
      return this.checking.then((value) => ({ ...structuredClone(value), ...this.accountPreferences() }));
    }
    this.loading ??= (async () => {
      this.inventory ??= await this.store?.load() ?? emptyStatus();
      await this.adoptDefault(this.inventory);
      return this.inventory;
    })();
    return this.loading.then(() => ({ ...structuredClone(this.inventory ?? emptyStatus()), ...this.accountPreferences() }));
  }

  private accountPreferences() {
    return { defaultLogin: this.settings?.githubDefaultLogin ?? null,
      repositoryAccounts: this.settings?.githubRepositoryAccounts ?? [] };
  }

  /**
   * Without a chosen default, the first known authenticated account becomes
   * the default, preferring the account active in GitHub CLI at that moment.
   * It is saved so later changes to the active gh account never move repositories.
   */
  private async adoptDefault(inventory: GitHubAccountsStatus): Promise<void> {
    if (!this.settings || this.settings.githubDefaultLogin) return;
    const authenticated = inventory.accounts.filter(account => account.state === 'authenticated');
    const login = authenticated.find(account => account.login === inventory.activeLogin)?.login ?? authenticated[0]?.login;
    if (!login) return;
    try {
      this.defaultRevision = ++this.revision;
      await this.settings.setGitHubDefaultLogin(login);
    } catch { /* Retried on the next inventory read. */ }
    finally { this.changed(undefined, true); }
  }

  selection(repository: RepositoryInfo): GitHubAccountSelection {
    return this.settings?.githubAccount(repository.commonDir) ?? { ...DEFAULT_GITHUB_ACCOUNT };
  }

  /** The account a repository uses for GitHub and HTTPS Git, or null for Git's own credentials. */
  resolve(repository: RepositoryInfo): { login: string | null; source: GitHubAccountSource } {
    return resolveGitHubAccount(this.selection(repository), this.settings?.githubDefaultLogin ?? null);
  }

  /** The account new repositories follow, or null when Git keeps its own credentials. */
  defaultLogin(): string | null {
    return this.settings?.githubDefaultLogin ?? null;
  }

  /** A connected account's token for one operation, verified to still authenticate that account. */
  async accountToken(login: string, operation: string): Promise<string> {
    const detection = await this.detect();
    if (detection.state !== 'available' || !detection.candidate) throw new GhOperationError({ code: detection.state === 'not-found' ? 'GH_CLI_NOT_FOUND' : 'GH_PROCESS_FAILED', operation,
      message: detection.state === 'not-found' ? 'GitHub CLI is not installed on the backend host.' : 'GitHub CLI could not run. Check Settings → GitHub.' });
    const auth = await accountAuthentication(login, detection.candidate, this.runner, operation);
    const verified = await this.identity(detection.candidate, auth, operation);
    const token = auth.env?.GH_TOKEN;
    if (!token || verified.toLowerCase() !== login.toLowerCase()) throw new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation,
      message: `The saved credentials for @${login} authenticate a different account. Authenticate @${login} again and check Settings → GitHub.` });
    return token;
  }

  context(repository: RepositoryInfo, remote: string, nameWithOwner: string | null): GitHubRepositoryAccount {
    const cached = this.contexts.get(repository.id);
    if (cached?.remote === remote && cached.value.revision === this.revisionFor(repository)) return structuredClone(cached.value);
    const selection = this.selection(repository);
    const resolved = this.resolve(repository);
    return { selection, nameWithOwner, login: resolved.login, source: resolved.login ? resolved.source : null,
      state: 'unchecked', checkedAt: null, revision: this.revisionFor(repository) };
  }

  async setSelection(repository: RepositoryInfo, selection: GitHubAccountSelection, detected?: GitHubAccountDetection): Promise<void> {
    if (!this.settings) throw new Error('GitHub account settings are unavailable.');
    const saving = this.settings.setGitHubAccount(repository.commonDir, selection);
    // Settings updates its in-memory choice before persisting it. Reserve the
    // revision now so another client's prepared save cannot overwrite that choice.
    this.invalidate(repository, detected);
    try { await saving; }
    catch (error) { this.invalidate(repository); throw error; }
  }

  /**
   * Connected accounts that can read `nameWithOwner`, accounts with push
   * permission first. Probes run with each account's own token and are reused
   * for a minute; accounts that fail to authenticate are skipped.
   */
  accountsWithAccess(nameWithOwner: string, operation: string): Promise<Array<{ login: string; push: boolean }>> {
    const key = nameWithOwner.toLowerCase();
    const cached = this.access.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
    const promise = (async () => {
      let inventory = await this.status();
      if (!inventory.accounts.some(account => account.state === 'authenticated')) inventory = await this.status(true);
      const detection = await this.detect();
      const executable = detection.candidate;
      if (detection.state !== 'available' || !executable) return [];
      const results = await Promise.all(inventory.accounts.filter(account => account.state === 'authenticated').map(async ({ login }) => {
        try {
          const auth = await accountAuthentication(login, executable, this.runner, operation);
          const result = await this.runner.run(executable.executable, ['api', `repos/${nameWithOwner}`], {
            cwd: os.homedir(), env: { ...executable.env, ...GH_ENV, ...auth.env }, ...(auth.removeEnv ? { removeEnv: auth.removeEnv } : {}),
            timeoutMs: 15_000, maxOutputBytes: 128 * 1024,
          });
          if (result.exitCode !== 0) return null;
          const data = JSON.parse(result.stdout) as { permissions?: { push?: boolean } };
          return { login, push: data.permissions?.push === true };
        } catch { return null; }
      }));
      return results.filter((result): result is { login: string; push: boolean } => result !== null).sort((a, b) => Number(b.push) - Number(a.push));
    })();
    this.access.set(key, { at: Date.now(), promise });
    void promise.catch(() => { if (this.access.get(key)?.promise === promise) this.access.delete(key); });
    return promise;
  }

  /**
   * For a repository following the default account, chooses a connected
   * account that can access it when the default cannot, and saves it as the
   * repository's account. Returns the chosen login, or null when nothing changed:
   * the repository has its own account, the default already has access, no
   * account has access, or the choice changed meanwhile.
   */
  async adoptAccountWithAccess(repository: RepositoryInfo, nameWithOwner: string, operation: string): Promise<string | null> {
    if (this.selection(repository).mode !== 'default') return null;
    const revision = this.revisionFor(repository);
    const previousLogin = this.resolve(repository).login;
    const candidates = await this.accountsWithAccess(nameWithOwner, operation);
    if (!candidates.length || candidates.some(candidate => candidate.login.toLowerCase() === previousLogin?.toLowerCase())) return null;
    if (revision !== this.revisionFor(repository) || this.selection(repository).mode !== 'default') return null;
    const login = candidates[0]!.login;
    await this.setSelection(repository, { mode: 'account', host: 'github.com', login, detected: true }, { login, previousLogin });
    return login;
  }

  async setDefaultAccount(login: string): Promise<GitHubAccountsStatus> {
    if (!this.settings) throw new Error('GitHub account settings are unavailable.');
    // Invalidate prepared operations only for repositories following this default.
    this.defaultRevision = ++this.revision;
    try { await this.settings.setGitHubDefaultLogin(login); }
    finally { this.changed(undefined, true); }
    return this.status();
  }

  private invalidate(repository?: RepositoryInfo, detected?: GitHubAccountDetection): void {
    this.revision++;
    if (repository) {
      const key = githubRepositoryKey(repository.commonDir);
      this.revisions.set(key, this.revision);
    } else {
      // Inventory refresh invalidates checks, not saved operation identities.
      this.contexts.clear();
    }
    this.ssh.clear();
    this.identities.clear();
    this.changed(repository, false, detected);
  }

  refreshAuthentication(): void {
    this.ssh.clear();
    this.identities.clear();
    this.access.clear();
  }

  async detect(force = false): Promise<CliDetection> {
    if (force || !this.detection || Date.now() - this.detection.at > CACHE_MS) {
      this.detection = { at: Date.now(), promise: selectCli(this.resolver, this.runner, 'gh', { forceRefresh: force,
        runOptions: { cwd: os.homedir(), env: { ...GH_ENV }, removeEnv: ['GH_DEBUG', 'DEBUG'] } }) };
    }
    return this.detection.promise;
  }

  async authenticate(repository: RepositoryInfo, remote: string, nameWithOwner: string, operation: string) {
    const revision = this.revisionFor(repository);
    const selection = this.selection(repository);
    const resolved = this.resolve(repository);
    let login: string | null = resolved.login;
    let source: GitHubRepositoryAccount['source'] = resolved.login ? resolved.source : null;
    try {
      const detection = await this.detect();
      if (detection.state !== 'available' || !detection.candidate) throw new GhOperationError({ code: detection.state === 'not-found' ? 'GH_CLI_NOT_FOUND' : 'GH_PROCESS_FAILED', operation,
        message: detection.state === 'not-found' ? 'GitHub CLI is not installed on the backend host.' : 'GitHub CLI could not run. Check Settings → GitHub.' });
      const executable = detection.candidate;
      // Git's own credentials over SSH identify the account from the SSH key.
      if (!login && parseSshRemote(remote)) {
        const override = executable.env.GIT_SSH_COMMAND || executable.env.GIT_SSH || process.env.GIT_SSH_COMMAND || process.env.GIT_SSH;
        const configured = await this.git.run(repository.path, ['config', '--default', '', '--get', 'core.sshCommand'], {
          operation: 'github-ssh-configuration', readOnly: true, maxOutputBytes: 8 * 1024,
        });
        if (override || configured.stdout.toString('utf8').trim()) throw new GhOperationError({ code: 'GH_ACCOUNT_UNRESOLVED', operation,
          message: 'This repository uses a custom SSH command. Choose an account in Settings → GitHub.' });
        const key = `${repository.path}\0${remote}`;
        let cached = this.ssh.get(key);
        if (!cached || Date.now() - cached.at > CACHE_MS) {
          cached = { at: Date.now(), promise: identifySshAccount(remote, this.runner) };
          this.ssh.set(key, cached);
        }
        login = await cached.promise;
        source = 'ssh';
        if (!login) throw new GhOperationError({ code: 'GH_ACCOUNT_UNRESOLVED', operation,
          message: 'SSH could not verify a GitHub user account. Check again or choose an account in Settings → GitHub. Deploy keys do not identify user accounts.' });
      }
      if (!source) source = executable.env.GH_TOKEN || executable.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? 'environment' : 'global';
      const auth = await accountAuthentication(login, executable, this.runner, operation);
      const verified = await this.identity(executable, auth, operation);
      if (login && login.toLowerCase() !== verified.toLowerCase()) throw new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation,
        message: `The saved credentials for @${login} authenticate a different account. Authenticate @${login} again and check Settings → GitHub.` });
      login = verified;
      const context: GitHubRepositoryAccount = { selection, nameWithOwner, login, source, state: 'ready', checkedAt: new Date().toISOString(), revision };
      if (revision === this.revisionFor(repository)) {
        const previous = this.contexts.get(repository.id)?.value;
        if (previous?.state === 'ready' && previous.revision === revision && (previous.login?.toLowerCase() !== login.toLowerCase() || previous.source !== source)) {
          // External gh/SSH changes discovered by any operation invalidate old-account reads.
          this.invalidate(repository);
          context.revision = this.revisionFor(repository);
        }
        this.contexts.set(repository.id, { remote, value: context });
      }
      return { auth, executable, context };
    } catch (error) {
      const message = error instanceof GhOperationError ? error.message : 'Could not inspect GitHub authentication. Check Settings → GitHub again.';
      if (revision === this.revisionFor(repository)) this.contexts.set(repository.id, { remote, value: { selection, nameWithOwner, login, source,
        state: 'error', checkedAt: new Date().toISOString(), message, revision } });
      if (error instanceof GhOperationError) throw error;
      throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message, retryable: true });
    }
  }

  /** The account last verified for this repository, including one from the environment or SSH. */
  verifiedLogin(repository: RepositoryInfo): string | null {
    return this.contexts.get(repository.id)?.value.login ?? this.resolve(repository).login;
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
        if (/HTTP 401|bad credentials|requires authentication/i.test(result.stderr)) {
          throw new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation, message: 'GitHub rejected these credentials. They may be expired or revoked. Authenticate this account again and check Settings → GitHub.' });
        }
        // A rate limit, an outage, and a dropped connection need different things from the user.
        if (!result.stderr.trim()) throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Could not verify this GitHub account. Check your connection and try again.', retryable: true });
        const { detail } = classifyFailure({ ...result, stdout: '', stderr: redactCommandToken(result.stderr, auth) }, operation);
        throw new GhOperationError({ ...detail, retryable: true });
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
    await this.adoptDefault(result);
    return result;
  }
}
