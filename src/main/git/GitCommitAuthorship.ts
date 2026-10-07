import { createHmac, randomBytes } from 'node:crypto';
import { chmod, lstat, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { commitAuthorshipInputSchema, type CommitAuthorship, type CommitIdentity, type SetCommitAuthorshipInput } from '../../shared/commit-authorship';
import { GitOperationError } from '../../shared/errors';
import type { GitProcess } from './GitProcess';
import type { RepositoryService } from './RepositoryService';

interface IdentityConfig { scope: string; key: string; value: string }
const environmentKeys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'];
const identityPattern = '^(user|author|committer)\\.(name|email)$';

/** Git owns persistence; no GitHub token or login participates in authorship. */
export class GitCommitAuthorship {
  private readonly revisionKey = randomBytes(32);

  constructor(private readonly git: GitProcess, private readonly repositories: RepositoryService) {}

  async get(repositoryId: string): Promise<CommitAuthorship> {
    const repository = this.repositories.get(repositoryId);
    return this.git.runWriteTask(repository.path, () => this.read(repositoryId), repository.commonDir);
  }

  async set(repositoryId: string, input: SetCommitAuthorshipInput): Promise<CommitAuthorship> {
    const parsed = commitAuthorshipInputSchema.safeParse(input);
    if (!parsed.success) throw invalid('Enter a valid name, email and reviewed identity.');
    const { name, email, expectedRevision } = parsed.data;
    const repository = this.repositories.get(repositoryId);
    const configPath = path.join(repository.commonDir, 'config');
    const lockPath = `${configPath}.lock`;
    return this.git.runWriteTask(repository.path, async (run) => {
      const current = await this.read(repositoryId);
      if (!current.editable) throw invalid(current.blockers.join(' '));
      if (current.revision !== expectedRevision) throw invalid('Git identity or repository settings changed. Reopen the editor and review them again.');
      let locked = false;
      try {
        // Use Git's normal config lock to exclude other Git clients. Both fields
        // are edited in this private copy, then published by one atomic rename.
        const file = await open(lockPath, 'wx', 0o600);
        locked = true;
        try { await file.writeFile(await readFile(configPath)); } finally { await file.close(); }
        const reviewed = await this.read(repositoryId);
        if (!reviewed.editable || reviewed.revision !== expectedRevision) throw invalid('Git settings changed before saving. Reopen the editor and review them again.');
        const mode = (await lstat(configPath)).mode & 0o777;
        await run(['config', '--file', lockPath, '--replace-all', '--', 'user.name', name], { operation: 'commit-authorship-set' });
        await run(['config', '--file', lockPath, '--replace-all', '--', 'user.email', email], { operation: 'commit-authorship-set' });
        // Including the candidate last reproduces its include ordering without
        // exposing a half-written real config. Includes may override user.*.
        const candidate = await this.identities(repository.path, ['-c', `include.path=${lockPath}`]);
        if (candidate.author?.name !== name || candidate.author.email !== email
          || candidate.committer?.name !== name || candidate.committer.email !== email) {
          throw invalid('An included Git setting overrides this identity. Edit that setting outside OpenTig before applying a repository identity.');
        }
        const latest = await this.read(repositoryId);
        if (!latest.editable || latest.revision !== expectedRevision) throw invalid('Git settings changed while saving. Reopen the editor and review them again.');
        await chmod(lockPath, mode);
        await rename(lockPath, configPath);
        locked = false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw invalid('Another Git process is editing repository settings. Wait for it to finish and try again.');
        }
        throw error;
      } finally {
        if (locked) await rm(lockPath, { force: true });
      }
      return this.read(repositoryId);
    }, repository.commonDir);
  }

  private async read(repositoryId: string): Promise<CommitAuthorship> {
    const repository = this.repositories.get(repositoryId);
    const configPath = path.join(repository.commonDir, 'config');
    const [entries, identities, config, info] = await Promise.all([
      this.config(repository.path), this.identities(repository.path), readFile(configPath), lstat(configPath),
    ]);
    const environment = environmentKeys.filter((key) => process.env[key] !== undefined);
    const custom = entries.some((entry) => entry.key.startsWith('author.') || entry.key.startsWith('committer.'));
    const worktree = entries.some((entry) => entry.scope === 'worktree');
    const command = entries.some((entry) => entry.scope === 'command');
    const blockers: string[] = [];
    if (environment.length) blockers.push('Backend environment variables override Git identity. Manage them outside OpenTig before editing repository authorship.');
    if (custom) blockers.push('Git author.* or committer.* settings override user.name/email. Manage those settings outside OpenTig first.');
    if (worktree) blockers.push('This worktree has its own identity. Manage its worktree settings outside OpenTig first.');
    if (command) blockers.push('Backend command configuration overrides Git identity. Manage it outside OpenTig first.');
    if (!info.isFile() || info.nlink !== 1) blockers.push('The repository config is linked or shared. Edit it outside OpenTig to avoid changing another repository.');
    const scopes = ['user.name', 'user.email'].map((key) => entries.filter((entry) => entry.key === key).at(-1)?.scope ?? 'inferred');
    const source: CommitAuthorship['source'] = environment.length || command ? 'environment' : custom ? 'custom' : worktree ? 'worktree'
      : !identities.author ? 'unset' : scopes[0] !== scopes[1] ? 'mixed'
        : scopes[0] === 'local' || scopes[0] === 'global' || scopes[0] === 'system' ? scopes[0] : 'inferred';
    // HMAC hides even configuration hashes (the config can contain secrets).
    // Time stamps returned by git var are deliberately excluded from revisions.
    const revision = createHmac('sha256', this.revisionKey).update(repository.path).update(config)
      .update(JSON.stringify({ entries, identities, environment, mode: info.mode, linked: info.nlink, blockers })).digest('hex');
    return { ...identities, source, editable: blockers.length === 0, blockers, revision };
  }

  private async config(cwd: string): Promise<IdentityConfig[]> {
    try {
      const output = await this.git.run(cwd, ['config', '--null', '--show-scope', '--get-regexp', identityPattern], { operation: 'commit-authorship-read', readOnly: true });
      const fields = output.stdout.toString('utf8').split('\0');
      const entries: IdentityConfig[] = [];
      for (let index = 0; index + 1 < fields.length; index += 2) {
        const field = fields[index + 1]!;
        const separator = field.indexOf('\n');
        if (separator >= 0) entries.push({ scope: fields[index]!, key: field.slice(0, separator), value: field.slice(separator + 1) });
      }
      return entries;
    } catch (error) {
      if (error instanceof GitOperationError && error.detail.exitCode === 1) return [];
      throw error;
    }
  }

  private async identities(cwd: string, prefix: string[] = []): Promise<{ author: CommitIdentity | null; committer: CommitIdentity | null }> {
    const [author, committer] = await Promise.all(['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'].map(async (variable) => {
      try {
        const output = await this.git.run(cwd, [...prefix, 'var', variable], { operation: 'commit-authorship-read', readOnly: true });
        const match = /^(.*?) <([^<>]*)> \d+ [+-]\d{4}$/.exec(output.stdout.toString('utf8').trim());
        if (!match) throw invalid('Git returned an unreadable commit identity.');
        return { name: match[1]!, email: match[2]! };
      } catch (error) {
        if (error instanceof GitOperationError && error.detail.exitCode === 128
          && /identity unknown|unable to auto-detect|empty ident|no email was given|no name was given/i.test(error.detail.stderr ?? '')) return null;
        throw error;
      }
    }));
    return { author: author!, committer: committer! };
  }
}

function invalid(message: string): GitOperationError {
  return new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'commit-authorship-set', message });
}
