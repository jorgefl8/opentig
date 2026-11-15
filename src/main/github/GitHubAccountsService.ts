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
import { notePerformance } from '../performance/PerformanceLog';

const CACHE_MS = 60_000;
/**
 * How long an account's token is reused. It is held in this process's memory
 * only: never saved, logged, or sent to a client, and dropped at once when an
 * account or the choice of account changes.
 */
export const TOKEN_REUSE_MS = 5 * 60_000;

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
  private identities = new Map<string, { at: number; promise: Promise<string>; login?: string; rechecking?: boolean }>();
  private tokens = new Map<string, { at: number; promise: Promise<GitHubCommandAuth> }>();
  private detected: CliDetection | null = null;
  private redetecting = false;
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
      this.tokens.clear();
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
    // Git's own fetches and pushes get a token read for them, never a reused one.
    const detection = await this.detect(false, true);
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
      const detection = await this.detect(false, true);
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
    this.tokens.clear();
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
    this.tokens.clear();
    this.changed(repository, false, detected);
  }

  refreshAuthentication(): void {
    this.ssh.clear();
    this.identities.clear();
    this.tokens.clear();
    this.access.clear();
  }

  /**
   * The token of `login`, or of GitHub CLI's own account when null. A run of
   * reads shares the token of a named account for `TOKEN_REUSE_MS`. GitHub CLI
   * is asked every time for its own account, which `gh auth switch` changes
   * without telling anyone, and when `fresh`, as every change made on GitHub is.
   */
  private credentials(login: string | null, executable: CliCandidate, operation: string, fresh = false): Promise<GitHubCommandAuth> {
    if (login === null) return accountAuthentication(null, executable, this.runner, operation);
    const key = `${executable.executable}\0${login.toLowerCase()}`;
    const held = this.tokens.get(key);
    const reused = !fresh && held !== undefined && Date.now() - held.at < TOKEN_REUSE_MS;
    notePerformance({ kind: 'cache', cache: 'github-token', resource: 'token', outcome: reused ? 'hit' : 'miss' });
    if (reused) return held.promise;
    const promise = accountAuthentication(login, executable, this.runner, operation);
    const entry = { at: Date.now(), promise };
    this.tokens.set(key, entry);
    // A failure is never kept, and neither is a token read while the accounts changed.
    void promise.catch(() => { if (this.tokens.get(key) === entry) this.tokens.delete(key); });
    return promise;
  }

  /** The last detection, however old, without starting one. */
  get lastDetection(): Promise<CliDetection> | null { return this.detection?.promise ?? null; }

  /**
   * Finds GitHub CLI, at most once a minute. After a pause a read uses the CLI
   * that last worked while it is looked for again, so it doesn't wait for that;
   * `current` waits, as a forced check and every change made on GitHub do.
   */
  async detect(force = false, current = force): Promise<CliDetection> {
    const expired = !this.detection || Date.now() - this.detection.at > CACHE_MS;
    if (!force && !current && expired && this.detected?.state === 'available') {
      if (!this.redetecting) {
        this.redetecting = true;
        const previous = this.detected;
        void this.startDetection(false).then((next) => {
          // Another CLI may hold other accounts: nothing kept for the old one is reused.
          if (next.state !== previous.state || next.candidate?.executable !== previous.candidate?.executable) this.refreshAuthentication();
        }, () => undefined).finally(() => { this.redetecting = false; });
      }
      return this.detected;
    }
    if (force || expired) return this.startDetection(force);
    return this.detection!.promise;
  }

  private startDetection(force: boolean): Promise<CliDetection> {
    const promise = selectCli(this.resolver, this.runner, 'gh', { forceRefresh: force,
      runOptions: { cwd: os.homedir(), env: { ...GH_ENV }, removeEnv: ['GH_DEBUG', 'DEBUG'] } });
    const entry = { at: Date.now(), promise };
    this.detection = entry;
    void promise.then((detected) => { if (this.detection === entry) this.detected = detected; }, () => undefined);
    return promise;
  }

  /**
   * The account and token an operation runs with. A read reuses what was
   * checked moments ago, and after a pause checks it again behind itself
   * rather than waiting. `fresh` is for a change made on GitHub: it asks
   * GitHub CLI for the token again and waits for an identity checked within the minute.
   */
  async authenticate(repository: RepositoryInfo, remote: string, nameWithOwner: string, operation: string, fresh = false) {
    const revision = this.revisionFor(repository);
    const selection = this.selection(repository);
    const resolved = this.resolve(repository);
    let login: string | null = resolved.login;
    let source: GitHubRepositoryAccount['source'] = resolved.login ? resolved.source : null;
    try {
      const detection = await this.detect(false, fresh);
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
      const auth = await this.credentials(login, executable, operation, fresh);
      const verified = await this.identity(executable, auth, operation, !fresh);
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

  /**
   * The login a token authenticates. A token always belongs to the same
   * account, so with `allowStale` a login checked before is used at once and
   * checked again behind the read; the check only finds out that the token
   * stopped working, which drops everything read with it.
   */
  private identity(executable: CliCandidate, auth: GitHubCommandAuth, operation: string, allowStale = false): Promise<string> {
    // Only a one-way credential fingerprint is retained as the key; the token stays in the operation's context and `tokens`.
    const fingerprint = createHash('sha256').update(auth.env?.GH_TOKEN ?? '').digest('hex');
    const cached = this.identities.get(fingerprint);
    const current = cached !== undefined && Date.now() - cached.at <= CACHE_MS;
    notePerformance({ kind: 'cache', cache: 'github-identity', resource: 'identity', outcome: current ? 'hit' : 'miss' });
    if (cached && current) return cached.promise;
    if (cached?.login && allowStale) {
      if (!cached.rechecking) {
        cached.rechecking = true;
        void this.readIdentity(executable, auth, operation).then((login) => {
          if (this.identities.get(fingerprint) !== cached) return;
          if (login.toLowerCase() === cached.login!.toLowerCase()) this.identities.set(fingerprint, { at: Date.now(), promise: cached.promise, login });
          else this.invalidate();
        }, (error: unknown) => {
          cached.rechecking = false;
          // Rejected credentials are gone for good; anything else is tried again by the next read.
          if (this.identities.get(fingerprint) === cached && error instanceof GhOperationError && error.detail.code === 'GH_AUTH_REQUIRED') this.invalidate();
        });
      }
      return cached.promise;
    }
    const promise = this.readIdentity(executable, auth, operation);
    const entry: { at: number; promise: Promise<string>; login?: string } = { at: Date.now(), promise };
    this.identities.set(fingerprint, entry);
    void promise.then((login) => { entry.login = login; }, () => { if (this.identities.get(fingerprint) === entry) this.identities.delete(fingerprint); });
    return promise;
  }

  private async readIdentity(executable: CliCandidate, auth: GitHubCommandAuth, operation: string): Promise<string> {
    const result = await this.runner.run(executable.executable, ['api', 'user', '--jq', '.login'], {
      cwd: os.homedir(), env: { ...executable.env, ...GH_ENV, ...auth.env }, ...(auth.removeEnv ? { removeEnv: auth.removeEnv } : {}),
      timeoutMs: 15_000, maxOutputBytes: 8 * 1024, operation: 'gh-identity',
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
