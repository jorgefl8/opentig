import { createHash } from 'node:crypto';
import type { CreateTrackingBranchRequest, DeleteRemoteBranchRequest, FetchResult } from '../../shared/contracts';
import type { BranchInfo, RemoteBranchDetails, RemoteBranchDeletionResult, TrackingBranchCreationResult } from '../../shared/git-types';
import { GitOperationError } from '../../shared/errors';
import type { GitProcess } from './GitProcess';
import type { RepositoryService } from './RepositoryService';
import { parseRefs, REF_FORMAT } from './RefParser';

type Run = (args: string[], options: { operation: string; readOnly?: boolean; timeoutMs?: number; maxOutputBytes?: number }) => Promise<{ stdout: Buffer }>;
interface Remote { name: string; refspecs: string[] }
interface Target { branch: BranchInfo; remote: string; sourceRef: string; branchName: string }
const read = { operation: 'remote-branches', readOnly: true, maxOutputBytes: 4 * 1024 * 1024 };
const network = { ...read, timeoutMs: 60_000 };

/** Remote branch writes never reuse the local branch deletion path. */
export class GitRemoteBranches {
  constructor(private readonly git: GitProcess, private readonly repositories: RepositoryService) {}

  private reader(root: string): Run { return (args, options) => this.git.run(root, args, options); }

  private async remotes(run: Run): Promise<Remote[]> {
    const names = (await run(['remote'], read)).stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
    return Promise.all(names.map(async (name) => ({ name, refspecs: (await this.config(run, `remote.${name}.fetch`)).split(/\r?\n/).filter(Boolean) })));
  }

  private async config(run: Run, key: string): Promise<string> {
    try { return (await run(['config', '--get-all', key], read)).stdout.toString('utf8').trim(); }
    catch (error) { if (error instanceof GitOperationError && error.detail.exitCode === 1) return ''; throw error; }
  }

  private mappings(fullName: string, remotes: Remote[]): Array<{ remote: string; sourceRef: string }> {
    return remotes.flatMap(remote => remote.refspecs.flatMap(spec => {
      if (spec.startsWith('^')) return [];
      const [source, destination] = spec.replace(/^\+/, '').split(':');
      if (!source?.startsWith('refs/heads/') || !destination?.startsWith('refs/remotes/')) return [];
      const match = refspecMatch(destination, fullName);
      if (match === null) return [];
      const sourceRef = source.replace('*', match);
      if (remote.refspecs.some(excluded => excluded.startsWith('^') && refspecMatch(excluded.slice(1), sourceRef) !== null)) return [];
      return [{ remote: remote.name, sourceRef }];
    }));
  }

  async snapshotBranches(repositoryId: string, branches: BranchInfo[]) {
    const root = this.repositories.get(repositoryId).path;
    const run = this.reader(root);
    const remotes = await this.remotes(run);
    const aliases = new Set((await run(['for-each-ref', '--format=%(refname)%09%(symref)', 'refs/remotes'], read)).stdout.toString('utf8')
      .split(/\r?\n/).filter(line => line.split('\t')[1]).map(line => line.split('\t')[0]));
    return { remotes: remotes.map(remote => remote.name), branches: branches.filter(branch => !aliases.has(branch.fullName)).map(branch => {
      if (!branch.remote) return branch;
      const mappings = this.mappings(branch.fullName, remotes);
      if (mappings.length !== 1) return branch;
      return { ...branch, remoteName: mappings[0]!.remote, remoteBranchName: mappings[0]!.sourceRef.slice('refs/heads/'.length) };
    }) };
  }

  private async target(fullName: string, run: Run): Promise<Target | null> {
    // Match exactly: for-each-ref's pattern matching must not pick a child ref.
    const branches = parseRefs((await run(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/remotes'], read)).stdout);
    const branch = branches.find(item => item.fullName === fullName);
    if (!branch) return null;
    const aliases = (await run(['for-each-ref', '--format=%(refname)%09%(symref)', fullName], read)).stdout.toString('utf8')
      .split(/\r?\n/).some(line => line.split('\t')[0] === fullName && Boolean(line.split('\t')[1]));
    const mappings = this.mappings(fullName, await this.remotes(run));
    if (aliases || mappings.length !== 1) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'remote-branch',
      message: 'This reference does not map to one configured remote branch. Check the remote fetch settings.' });
    return { branch, ...mappings[0]!, branchName: mappings[0]!.sourceRef.slice('refs/heads/'.length) };
  }

  private async destination(target: Target, run: Run) {
    const fetchUrls = (await run(['remote', 'get-url', '--all', '--', target.remote], read)).stdout.toString('utf8').trim().split(/\r?\n/);
    const pushUrls = (await run(['remote', 'get-url', '--push', '--all', '--', target.remote], read)).stdout.toString('utf8').trim().split(/\r?\n/);
    const id = createHash('sha256').update(JSON.stringify([target.remote, target.sourceRef, fetchUrls, pushUrls])).digest('hex');
    const blocked = fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== pushUrls[0]
      ? 'Fetch and push destinations differ or have multiple URLs. Manage remote deletion outside OpenTig.' : null;
    return { id, blocked, url: fetchUrls[0]! };
  }

  private async advertised(target: Target, run: Run, url: string) {
    const lines = (await run(['ls-remote', '--symref', '--', url, 'HEAD', target.sourceRef], network)).stdout.toString('utf8').split(/\r?\n/);
    const defaultRef = lines.find(line => line.startsWith('ref: refs/heads/') && line.endsWith('\tHEAD'))?.split('\t')[0]?.slice(5) ?? null;
    const oid = lines.find(line => line.split('\t')[1] === target.sourceRef)?.split('\t')[0] ?? null;
    return { defaultRef, oid };
  }

  async details(repositoryId: string, fullName: string): Promise<RemoteBranchDetails> {
    const run = this.reader(this.repositories.get(repositoryId).path);
    const target = await this.target(fullName, run);
    if (!target) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'remote-branch-details', message: 'The remote reference no longer exists. Fetch branches again.' });
    const destination = await this.destination(target, run);
    let blocked = destination.blocked;
    let defaultRef: string | null = null;
    let remoteState: RemoteBranchDetails['remoteState'] = 'unchecked';
    if (!blocked) {
      try {
        const state = await this.advertised(target, run, destination.url);
        defaultRef = state.defaultRef;
        remoteState = !state.oid ? 'missing' : state.oid === target.branch.oid ? 'current' : 'changed';
        blocked = !state.oid ? 'The branch no longer exists on the remote. Fetch to remove the obsolete reference.'
          : state.oid !== target.branch.oid ? 'The remote branch changed since the last fetch. Fetch before deleting.'
          : !state.defaultRef ? 'The remote does not identify its default branch. Deletion is unavailable here.'
          : state.defaultRef === target.sourceRef ? 'This is the remote’s default branch and cannot be deleted here.' : null;
      } catch { blocked = 'Could not check the remote. Fetch again or check your connection and Git permissions.'; }
    }
    const upstreams = (await run(['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(upstream)%00%(worktreepath)', 'refs/heads'], read)).stdout.toString('utf8');
    const localBranches = upstreams.split(/\r?\n/).map(line => line.split('\0')).filter(fields => fields[2] === fullName)
      .map(([ref, name, , worktreePath]) => ({ fullName: ref!, name: name!, worktreePath: worktreePath || null }));
    return { ...target.branch, remote: target.remote, branchName: target.branchName, localBranches,
      defaultBranch: defaultRef?.slice('refs/heads/'.length) ?? null, remoteState, destinationId: destination.id, deletionBlockedReason: blocked };
  }

  async create(request: CreateTrackingBranchRequest): Promise<TrackingBranchCreationResult> {
    const repository = this.repositories.get(request.repositoryId);
    return this.git.runWriteTask(repository.path, async run => {
      const target = await this.target(request.fullName, run);
      if (!target) return { status: 'missing' };
      if (target.branch.oid !== request.expectedOid) return { status: 'stale' };
      if (request.localName.startsWith('-')) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'create-tracking-branch', message: 'Invalid local branch name.' });
      await run(['check-ref-format', `refs/heads/${request.localName}`], read);
      const localRef = `refs/heads/${request.localName}`;
      const existing = (await run(['for-each-ref', '--format=%(refname)', 'refs/heads'], read)).stdout.toString('utf8').trim().split(/\r?\n/);
      if (existing.includes(localRef)) return { status: 'exists' };
      await run(['branch', '--track', '--', request.localName, target.branch.fullName], { operation: 'create-tracking-branch' });
      return { status: 'created', fullName: localRef };
    }, repository.commonDir);
  }

  async delete(request: DeleteRemoteBranchRequest): Promise<RemoteBranchDeletionResult> {
    const repository = this.repositories.get(request.repositoryId);
    return this.git.runWriteTask(repository.path, async run => {
      const target = await this.target(request.fullName, run);
      if (!target) return { status: 'missing' };
      if (target.branch.oid !== request.expectedOid) return { status: 'stale' };
      const destination = await this.destination(target, run);
      if (destination.id !== request.destinationId) return { status: 'destination-changed' };
      if (destination.blocked) return { status: 'rejected', message: destination.blocked };
      try {
        const state = await this.advertised(target, run, destination.url);
        if (!state.oid) return { status: 'missing' };
        if (!state.defaultRef) return { status: 'rejected', message: 'Could not identify the remote default branch. Nothing was deleted.' };
        if (state.defaultRef === target.sourceRef) return { status: 'default' };
        if (state.oid !== request.expectedOid) return { status: 'stale' };
        // The lease is checked by the server, including races after ls-remote.
        await run(['-c', `remote.${target.remote}.mirror=false`, 'push', '--porcelain', '--no-follow-tags',
          `--force-with-lease=${target.sourceRef}:${request.expectedOid}`, '--', destination.url, `:${target.sourceRef}`],
        { operation: 'delete-remote-branch', timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024 });
        return { status: 'deleted' };
      } catch { return { status: 'rejected', message: 'Git refused the remote deletion. Check permissions or branch protection, fetch, and try again. No local branch or worktree was removed.' }; }
    }, repository.commonDir);
  }

  async fetch(repositoryId: string): Promise<FetchResult> {
    const repository = this.repositories.get(repositoryId);
    try {
      await this.git.runWriteTask(repository.path, async run => {
        for (const remote of await this.remotes(run)) {
          const specs = remote.refspecs.filter(spec => spec.startsWith('^refs/heads/') || /^\+?refs\/heads\/[^:]+:refs\/remotes\//.test(spec));
          if (!specs.some(spec => !spec.startsWith('^'))) continue;
          await run(['-c', 'fetch.pruneTags=false', 'fetch', '--prune', '--no-prune-tags', '--no-tags', '--no-recurse-submodules', '--', remote.name, ...specs],
            { operation: 'fetch-branches', timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024 });
        }
      }, repository.commonDir);
    } catch { return { status: 'failed', message: 'Could not fetch all remote branches. Check your connection and Git credentials, then fetch again.' }; }
    const status = await this.repositories.status(repositoryId, false);
    return { status: 'success', ahead: status.ahead, behind: status.behind };
  }
}

/** Returns the wildcard capture, or an empty string for an exact match. */
function refspecMatch(pattern: string, ref: string): string | null {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === ref ? '' : null;
  const prefix = pattern.slice(0, star); const suffix = pattern.slice(star + 1);
  return ref.startsWith(prefix) && ref.endsWith(suffix) && ref.length >= prefix.length + suffix.length
    ? ref.slice(prefix.length, suffix ? -suffix.length : undefined) : null;
}
