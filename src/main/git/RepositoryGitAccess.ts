import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { RepositoryInfo } from '../../shared/contracts';
import type { GitHubAccountSelection } from '../../shared/github-accounts';
import type { PublicationContext, RepositoryAccess, AccessCheck } from '../../shared/repository-access';
import { GitOperationError } from '../../shared/errors';
import { redactSensitiveText } from '../../shared/redaction';
import type { GitHubAccountsService } from '../github/GitHubAccountsService';
import { GH_ENV, redactCommandToken } from '../github/GitHubAccountAuth';
import type { CliProcessRunner } from '../ai/CliProcessRunner';
import type { RepositoryService } from './RepositoryService';
import type { GitProcess, GitOutput, RunOptions } from './GitProcess';
import { createCredentialBroker, managedGitHubPath } from './GitCredentialBroker';

const read = { operation: 'repository-access', readOnly: true, maxOutputBytes: 1024 * 1024 };
const unchecked = (): AccessCheck => ({ state: 'unchecked' });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Session { repository: RepositoryInfo; selection: GitHubAccountSelection; revision: number; auth?: Awaited<ReturnType<GitHubAccountsService['authenticate']>> }

export class RepositoryGitAccess {
  private readonly sessions = new AsyncLocalStorage<Session>();
  private readonly checks = new Map<string, RepositoryAccess>();
  private readonly latest = new Map<string, NonNullable<RepositoryAccess['lastOperation']>>();
  constructor(private readonly git: GitProcess, private readonly repositories: RepositoryService,
    private readonly accounts: GitHubAccountsService, private readonly runner: CliProcessRunner) {}

  install() {
    this.git.network = (cwd, args, options, execute) => this.scope(cwd, () => this.execute(args, options, execute));
    this.git.authenticationKey = cwd => {
      const repository = this.repositories.recents().find(item => item.path === cwd);
      return repository ? digest([this.accounts.selection(repository), this.accounts.revisionFor(repository)]) : '';
    };
    this.git.networkScope = (cwd, task) => this.scope(cwd, task);
  }
  private async scope<T>(cwd: string, task: () => Promise<T>): Promise<T> {
    if (this.sessions.getStore()?.repository.path === cwd) return task();
    const repository = this.repositories.recents().find(item => item.path === cwd);
    if (!repository) throw new Error('The repository must be open before remote operations.');
    return this.sessions.run({ repository, selection: this.accounts.selection(repository), revision: this.accounts.revisionFor(repository) }, task);
  }
  private async config(repository: RepositoryInfo, key: string, all = false) {
    try { return (await this.git.run(repository.path, ['config', all ? '--get-all' : '--get', key], read)).stdout.toString('utf8').trim(); }
    catch (error) { if (error instanceof GitOperationError && error.detail.exitCode === 1) return ''; throw error; }
  }
  private async resolve(repository: RepositoryInfo, push: boolean, selected?: string) {
    const branch = (await this.git.run(repository.path, ['branch', '--show-current'], read)).stdout.toString('utf8').trim() || null;
    const remotes = (await this.git.run(repository.path, ['remote'], read)).stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
    let remote = selected;
    if (!remote) for (const key of [...(push ? [`branch.${branch}.pushRemote`, 'remote.pushDefault'] : []), `branch.${branch}.remote`]) {
      remote = await this.config(repository, key); if (remote) break;
    }
    if (!remote && !push && remotes.includes('origin')) remote = 'origin';
    remote ||= remotes.length === 1 ? remotes[0] : undefined;
    // Multiple destinations must be reviewed explicitly, never guessed from origin.
    let urls: string[] = [];
    if (remote === '.') urls = ['.'];
    else if (remote && remotes.includes(remote)) urls = (await this.git.run(repository.path, ['remote', 'get-url', ...(push ? ['--push', '--all'] : []), '--', remote], read)).stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
    else if (selected && !remotes.includes(selected)) {
      // --get-url applies insteadOf without contacting the network.
      urls = [(await this.git.run(repository.path, ['ls-remote', '--get-url', '--', selected], { ...read, operation: 'resolve-git-url' })).stdout.toString('utf8').trim()];
    }
    return { branch, remotes, remote: remote ?? null, urls };
  }
  async publication(repositoryId: string, selected?: string): Promise<PublicationContext> {
    const repository = this.repositories.get(repositoryId);
    const selection = this.accounts.selection(repository);
    const revision = this.accounts.revisionFor(repository);
    const target = await this.resolve(repository, true, selected);
    let oid: string | null = null;
    try { oid = (await this.git.run(repository.path, ['rev-parse', '--verify', 'HEAD'], read)).stdout.toString('utf8').trim(); } catch { /* unborn */ }
    const managed = selection.mode === 'account' && selection.gitMode === 'managed';
    const compatible = target.urls.length === 1 && !!managedGitHubPath(target.urls[0]!);
    const configuration = (await this.git.run(repository.path, ['config', '--null', '--list'], read)).stdout.toString('utf8');
    const upstreamRemote = await this.config(repository, `branch.${target.branch}.remote`);
    const merge = await this.config(repository, `branch.${target.branch}.merge`, true);
    const pushDefault = await this.config(repository, 'push.default') || 'simple';
    const targetRef = target.branch ? (target.remote === upstreamRemote && merge && ['simple', 'upstream'].includes(pushDefault) ? merge : `refs/heads/${target.branch}`) : null;
    const unsafe = merge && (merge.includes('\n') || !['simple', 'upstream', 'current'].includes(pushDefault) ||
      (pushDefault === 'simple' && target.remote === upstreamRemote && merge !== `refs/heads/${target.branch}`) ||
      (pushDefault === 'upstream' && target.remote !== upstreamRemote) ||
      await this.config(repository, `remote.${target.remote}.push`) || await this.config(repository, `remote.${target.remote}.mirror`) === 'true');
    const blocked = selected && selected !== '.' && !target.remotes.includes(selected) ? 'The selected push remote is not configured. Review the repository remotes.' : unsafe ? 'The push refspec, mirror or push.default configuration requires review in Git before publishing.' : target.urls.length > 1 ? 'This remote has multiple push URLs. Choose a single destination in Git configuration before publishing.'
      : target.remote && !target.urls.length ? 'The configured push remote is unavailable.'
        : managed && target.urls.some(isGitHubHttp) && !compatible ? 'Managed Git requires a plain github.com HTTPS destination. Review the URL or use external authentication.' : undefined;
    return { ...target, urls: target.urls.map(redactSensitiveText), repositoryId, oid, targetRef,
      id: digest([repository.commonDir, selection, revision, target, oid, configuration]),
      mode: managed && compatible ? 'managed' : 'external', login: managed && compatible && selection.mode === 'account' ? selection.login : null,
      ...(blocked ? { blocked } : {}) };
  }
  async assertPublication(repositoryId: string, expected?: string, remote?: string) {
    const current = await this.publication(repositoryId, remote);
    if (expected && expected !== current.id) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'push', message: 'The account, branch or destination changed. Review the publication context and try again.' });
    if (current.blocked) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'push', message: current.blocked });
    return current;
  }
  async status(repositoryId: string, force = false, apiContext?: { remote: string; nameWithOwner: string | null }): Promise<RepositoryAccess> {
    const publication = await this.publication(repositoryId);
    const repository = this.repositories.get(repositoryId);
    const previous = this.checks.get(repositoryId);
    const value: RepositoryAccess = previous?.publication.id === publication.id ? structuredClone(previous) : {
      publication, identity: unchecked(), api: unchecked(), read: publication.mode === 'external' ? { state: 'external' } : unchecked(), write: unchecked(), checkedAt: null,
    };
    const last = this.latest.get(repositoryId);
    if (last) value.lastOperation = last;
    if (!force) {
      if (value.checkedAt && Date.now() - Date.parse(value.checkedAt) > 60_000) for (const key of ['identity', 'api', 'read', 'write'] as const) {
        if (value[key].state === 'ok') value[key] = { state: 'stale', message: value[key].message ?? 'Check access again for a current result.' };
      }
      return value;
    }
    value.identity = unchecked(); value.api = unchecked(); value.write = unchecked();
    value.read = publication.mode === 'external' ? { state: 'external' } : unchecked();
    const selection = this.accounts.selection(repository);
    if (selection.mode !== 'account') {
      value.identity = { state: 'unchecked', message: 'Choose a saved account to pin access for this repository.' };
    } else {
      try {
        this.accounts.refreshAuthentication();
        const { auth, executable } = await this.accounts.authenticate(repository, apiContext?.remote ?? '', apiContext?.nameWithOwner ?? '', 'repository-access');
        value.identity = { state: 'ok' };
        const origin = await this.resolve(repository, false, 'origin');
        const apiUrl = origin.urls[0] ?? '';
        const apiPath = apiContext?.nameWithOwner ?? managedGitHubPath(apiUrl) ?? /^git@github\.com:([\w.-]+\/[\w.-]+)$/.exec(apiUrl)?.[1];
        const checkApi = async (name: string): Promise<{ check: AccessCheck; write: AccessCheck }> => {
          try {
            const result = await this.runner.run(executable.executable, ['api', `repos/${name.replace(/\.git$/, '')}`], {
              cwd: repository.path, env: { ...executable.env, ...GH_ENV, ...auth.env }, ...(auth.removeEnv ? { removeEnv: auth.removeEnv } : {}),
              timeoutMs: 15_000, maxOutputBytes: 128 * 1024,
            });
            if (result.exitCode !== 0) { const check = accessError(redactCommandToken(result.stderr, auth)); return { check, write: check }; }
            const data = JSON.parse(result.stdout) as { permissions?: { push?: boolean } };
            return { check: { state: 'ok' }, write: typeof data.permissions?.push === 'boolean'
              ? { state: data.permissions.push ? 'ok' : 'inaccessible', message: data.permissions.push ? 'Write permission declared by GitHub; branch policies still apply.' : 'GitHub does not declare write permission.' } : unchecked() };
          } catch (error) { const check = accessError(redactCommandToken(messageOf(error), auth)); return { check, write: check }; }
        };
        if (apiPath) value.api = (await checkApi(apiPath)).check;
        const destination = publication.urls[0];
        const pushPath = destination && managedGitHubPath(destination);
        if (pushPath) value.write = (await checkApi(pushPath)).write;
        if (publication.mode === 'managed' && destination && !publication.blocked) {
          try {
            await this.git.withNetworkContext(repository.path, () => this.git.run(repository.path, ['ls-remote', '--', destination, 'HEAD'], { ...read, timeoutMs: 30_000 }));
            value.read = { state: 'ok', message: 'Read verified at the push destination. This does not guarantee a push.' };
          } catch (error) { value.read = accessError(messageOf(error)); }
        }
      } catch (error) {
        if (value.identity.state === 'ok') value.api = accessError(messageOf(error));
        else value.identity = accessError(messageOf(error));
      }
    }
    // A late response is never presented as a success for a new account/target.
    if ((await this.publication(repositoryId)).id !== publication.id) return this.status(repositoryId, false, apiContext);
    value.checkedAt = new Date().toISOString();
    this.checks.set(repositoryId, value);
    return value;
  }
  private async execute(args: string[], options: RunOptions, execute: (args: string[], options: RunOptions) => Promise<GitOutput>) {
    const session = this.sessions.getStore()!;
    const { repository, selection } = session;
    let index = 0; while (args[index] === '-c') index += 2;
    const command = args[index]!;
    if (command === 'ls-remote' && args.includes('--get-url')) return execute(args, options);
    const selected = args.slice(index + 1).find(arg => !arg.startsWith('-'));
    const target = await this.resolve(repository, command === 'push', selected);
    if (target.urls.length !== 1) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: options.operation, message: 'The remote destination is ambiguous. Configure or choose a single remote URL.' });
    const url = target.urls[0]!;
    if (selected?.includes('://') && selected !== url) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: options.operation, message: 'URL rewriting changes the reviewed destination again. Resolve the chained rewrite before checking or publishing.' });
    const managed = selection.mode === 'account' && selection.gitMode === 'managed' && isGitHubHttp(url);
    let broker: Awaited<ReturnType<typeof createCredentialBroker>> | undefined;
    let token = '';
    try {
      if (managed) {
        if (!managedGitHubPath(url)) throw new Error('Managed Git cannot send credentials to this destination. Use external authentication for unsupported URLs.');
        if (!session.auth) {
          if (session.revision !== this.accounts.revisionFor(repository)) throw new Error('The repository account changed before the operation started. Review and retry.');
          session.auth = await this.accounts.authenticate(repository, url, managedGitHubPath(url)!, options.operation);
          if (session.revision !== this.accounts.revisionFor(repository) || digest(session.auth.context.selection) !== digest(selection)) throw new Error('The repository account changed before authentication completed. Review and retry.');
        }
        if (command === 'fetch' && !selected && target.remote) args = [...args, '--', target.remote];
        token = session.auth.auth.env?.GH_TOKEN ?? '';
        broker = await createCredentialBroker(url, selection.login, token);
        const config = (await this.git.run(repository.path, ['config', '--name-only', '--list'], read)).stdout.toString('utf8').trim().split(/\r?\n/);
        const overrides = [...new Set(config)].flatMap(key => {
          if (/^credential\..*helper$/i.test(key)) return ['-c', `${key}=`];
          if (/^http\..*extraheader$/i.test(key)) return ['-c', `${key}=`];
          if (/^http\..*followredirects$/i.test(key)) return ['-c', `${key}=false`];
          if (/^http\..*sslverify$/i.test(key)) return ['-c', `${key}=true`];
          if (/^credential\..*usehttppath$/i.test(key)) return ['-c', `${key}=true`];
          return [];
        });
        args = [...overrides, '-c', 'credential.helper=', '-c', `credential.helper=${broker.helper}`, '-c', 'credential.useHttpPath=true',
          '-c', 'core.askPass=', '-c', 'http.extraHeader=', '-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true',
          '-c', 'fetch.recurseSubmodules=false', '-c', 'push.recurseSubmodules=no', ...args];
      }
      if (options.publication) await this.assertPublication(options.publication.repositoryId, options.publication.id, options.publication.remote);
      const result = await execute(args, { ...options, ...(managed ? { managed: true, managedSecrets: [token] } : {}) });
      this.latest.set(repository.id, { operation: options.operation, url: redactSensitiveText(url), login: managed && selection.mode === 'account' ? selection.login : null, at: new Date().toISOString(), ok: true });
      return result;
    } catch (error) {
      const message = redactSensitiveText(token ? messageOf(error).split(token).join('[redacted]') : messageOf(error));
      this.latest.set(repository.id, { operation: options.operation, url: redactSensitiveText(url), login: managed && selection.mode === 'account' ? selection.login : null, at: new Date().toISOString(), ok: false, message });
      if (error instanceof GitOperationError) throw error;
      throw new GitOperationError({ code: 'UNKNOWN', operation: options.operation, message });
    } finally { await broker?.dispose(); }
  }
}
function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Could not check remote access.'; }
export function accessError(message: string): AccessCheck {
  return { state: /401|bad credentials|expired|revoked|no usable saved credentials/i.test(message) ? 'expired'
    : /404|403|not found|denied|not accessible/i.test(message) ? 'inaccessible' : 'offline', message: redactSensitiveText(message).slice(0, 1500) };
}

function isGitHubHttp(value: string): boolean { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname === 'github.com'; } catch { return false; } }
