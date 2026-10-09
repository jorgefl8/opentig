import type { BranchSwitchResult, CommitResult, DiffRequest, DiffResult, FetchResult, GitResult, PrepareCommitGroupInput, PublishBranchOptions, PullResult, PushResult, UndoLatestCommitResult, WorktreeRemovalResult } from '../../shared/contracts';
import type {
  BranchComparisonKind, BranchDeletionResult, BranchDetails, BranchInfo, CommitFile, CommitPage, CommitSummary,
  FileChange, LocalRefsSnapshot, WorktreeDetails, WorktreeInfo,
} from '../../shared/git-types';
import { AiOperationError, GitOperationError } from '../../shared/errors';
import { redactSensitiveText } from '../../shared/redaction';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FileService } from '../files/FileService';
import { realpath, stat, writeFile } from 'node:fs/promises';
import type { CommitMessageContext, PullRequestDraftContext } from '../ai/types';
import type { RepositoryInstructionFile } from '../ai/RepositoryAiInstructions';
import type { GitProcess } from './GitProcess';
import { parseCommitFiles } from './CommitFilesParser';
import { LOG_FORMAT, parseLog } from './LogParser';
import { selectHistoryBase } from './HistoryBase';
import { REF_FORMAT, parseRefs } from './RefParser';
import type { RepositoryService } from './RepositoryService';
import { allocatePatchBudget } from './PatchBudget';
import { allocatePullRequestPatch } from './PullRequestPatch';
import { buildPullRequestPrompt, PR_PROMPT_CHARACTER_LIMIT } from '../ai/PullRequestPrompt';
import { parseStatus } from './StatusParser';
import { parseWorktrees } from './WorktreeParser';
import { GitCommitAuthorship } from './GitCommitAuthorship';
import type { SetCommitAuthorshipInput } from '../../shared/commit-authorship';
import { GitRemoteBranches } from './GitRemoteBranches';
import type { CreateTrackingBranchRequest, DeleteRemoteBranchRequest } from '../../shared/contracts';

/**
 * Characters of staged diff and staged summary sent to the model. Generous on
 * purpose: a commit plan is only as good as the changes it can actually see, and
 * the budget is shared fairly across files rather than spent on the first ones.
 */
const AI_PATCH_BUDGET = 400_000;
const AI_SUMMARY_BUDGET = 24_000;
type GitTaskRunner = (
  args: string[],
  options: { operation: string; readOnly?: boolean; timeoutMs?: number; maxOutputBytes?: number; stdin?: string | Buffer; truncateOverflow?: boolean },
) => Promise<{ stdout: Buffer }>;

export class GitRepositoryOperations {
  access?: import('./RepositoryGitAccess').RepositoryGitAccess;
  publicationContext(repositoryId: string, remote?: string) {
    if (!this.access) throw new Error('Repository access is unavailable.');
    return this.access.publication(repositoryId, remote);
  }
  private readonly knownOids = new Map<string, Set<string>>();
  private readonly authorship: GitCommitAuthorship;
  private readonly remoteBranches: GitRemoteBranches;

  constructor(
    private readonly git: GitProcess,
    private readonly repositories: RepositoryService,
    private readonly files: FileService,
  ) { this.authorship = new GitCommitAuthorship(git, repositories); this.remoteBranches = new GitRemoteBranches(git, repositories); }

  remoteBranchDetails(repositoryId: string, fullName: string) { return this.remoteBranches.details(repositoryId, fullName); }
  createTrackingBranch(request: CreateTrackingBranchRequest) { return this.remoteBranches.create(request); }
  deleteRemoteBranch(request: DeleteRemoteBranchRequest) { return this.git.withNetworkContext(this.repositories.get(request.repositoryId).path, () => this.remoteBranches.delete(request)); }
  fetchBranches(repositoryId: string) { return this.git.withNetworkContext(this.repositories.get(repositoryId).path, () => this.remoteBranches.fetch(repositoryId)); }

  getCommitAuthorship(repositoryId: string) { return this.authorship.get(repositoryId); }

  setCommitAuthorship(repositoryId: string, input: SetCommitAuthorshipInput) { return this.authorship.set(repositoryId, input); }

  async diff(request: DiffRequest): Promise<DiffResult> {
    const repository = this.repositories.get(request.repositoryId);
    const paths = this.repositories.validatePaths(request.repositoryId, [request.path]);
    // A single index lookup replaces the previous full-worktree status: an
    // untracked file has no index entry, so `ls-files` returning nothing is
    // exactly the case that needs the synthetic all-added patch.
    const tracked = (await this.git.run(
      repository.path,
      ['--literal-pathspecs', 'ls-files', '-z', '--', ...paths],
      { operation: 'diff-tracked-check', readOnly: true, maxOutputBytes: 1024 * 1024 },
    )).stdout.length > 0;
    if (request.kind === 'unstaged' && !tracked) return this.untrackedDiff(request.repositoryId, request.path);
    const args = ['--literal-pathspecs', 'diff'];
    if (request.kind === 'staged') args.push('--cached');
    args.push('--no-color', '--no-ext-diff', '--unified=3', '--', ...paths);
    const output = await this.git.run(repository.path, args, { operation: `diff-${request.kind}`, readOnly: true, maxOutputBytes: 32 * 1024 * 1024 });
    return makeDiffResult(request.path, output.stdout);
  }

  async commitDiff(repositoryId: string, oid: string): Promise<DiffResult> {
    this.assertKnownOid(repositoryId, oid);
    const repository = this.repositories.get(repositoryId);
    const output = await this.git.run(repository.path, ['show', '--format=', '--no-color', '--no-ext-diff', oid, '--'], { operation: 'commit-diff', readOnly: true, maxOutputBytes: 32 * 1024 * 1024 });
    return makeDiffResult(oid, output.stdout);
  }

  async commitFiles(repositoryId: string, oid: string): Promise<CommitFile[]> {
    this.assertKnownOid(repositoryId, oid);
    const repository = this.repositories.get(repositoryId);
    const common = ['show', '--format=', '--no-color', '--no-ext-diff', '-M', '-z'];
    const [nameStatus, numstat] = await Promise.all([
      this.git.run(repository.path, [...common, '--name-status', oid, '--'], { operation: 'commit-files', readOnly: true, maxOutputBytes: 8 * 1024 * 1024 }),
      this.git.run(repository.path, [...common, '--numstat', oid, '--'], { operation: 'commit-files', readOnly: true, maxOutputBytes: 8 * 1024 * 1024 }),
    ]);
    return parseCommitFiles(nameStatus.stdout.toString('utf8'), numstat.stdout.toString('utf8'));
  }

  async commitFileDiff(repositoryId: string, oid: string, filePath: string, oldPath?: string): Promise<DiffResult> {
    this.assertKnownOid(repositoryId, oid);
    const repository = this.repositories.get(repositoryId);
    const paths = this.repositories.validatePaths(repositoryId, oldPath ? [filePath, oldPath] : [filePath]);
    const output = await this.git.run(
      repository.path,
      ['--literal-pathspecs', 'show', '--format=', '--no-color', '--no-ext-diff', '-M', oid, '--', ...paths],
      { operation: 'commit-file-diff', readOnly: true, maxOutputBytes: 32 * 1024 * 1024 },
    );
    return makeDiffResult(filePath, output.stdout);
  }

  async stage(repositoryId: string, paths: string[]): Promise<GitResult> {
    await this.ensureWritable(repositoryId);
    const repository = this.repositories.get(repositoryId);
    const valid = this.repositories.validatePaths(repositoryId, paths);
    await this.git.runWrite(repository.path, ['--literal-pathspecs', 'add', '-A', '--', ...valid], { operation: 'stage' });
    return { ok: true };
  }

  async stageAll(repositoryId: string): Promise<GitResult> {
    await this.ensureWritable(repositoryId);
    const repository = this.repositories.get(repositoryId);
    await this.git.runWrite(repository.path, ['add', '-A', '--', '.'], { operation: 'stage-all' });
    return { ok: true };
  }

  async unstage(repositoryId: string, paths: string[]): Promise<GitResult> {
    await this.ensureWritable(repositoryId);
    const repository = this.repositories.get(repositoryId);
    const valid = this.repositories.validatePaths(repositoryId, paths);
    const hasHead = await this.hasHead(repository.path);
    const args = hasHead
      ? ['--literal-pathspecs', 'restore', '--staged', '--', ...valid]
      : ['--literal-pathspecs', 'rm', '--cached', '-r', '--', ...valid];
    await this.git.runWrite(repository.path, args, { operation: 'unstage' });
    return { ok: true };
  }

  async discard(repositoryId: string, paths: string[]): Promise<GitResult> {
    await this.ensureWritable(repositoryId);
    if (paths.length === 0) return { ok: true };
    const repository = this.repositories.get(repositoryId);
    const valid = this.repositories.validatePaths(repositoryId, paths);
    await this.git.runWrite(repository.path, ['--literal-pathspecs', 'restore', '--worktree', '--', ...valid], { operation: 'discard' });
    return { ok: true };
  }

  async unstageAll(repositoryId: string): Promise<GitResult> {
    await this.ensureWritable(repositoryId);
    const repository = this.repositories.get(repositoryId);
    const hasHead = await this.hasHead(repository.path);
    const args = hasHead ? ['restore', '--staged', '--', '.'] : ['rm', '--cached', '-r', '--', '.'];
    await this.git.runWrite(repository.path, args, { operation: 'unstage-all' });
    return { ok: true };
  }

  async prepareCommitGroup(input: PrepareCommitGroupInput): Promise<GitResult> {
    await this.ensureWritable(input.repositoryId);
    const repository = this.repositories.get(input.repositoryId);
    const paths = this.repositories.validatePaths(input.repositoryId, input.paths).sort();
    const expectedStagedPaths = input.expectedStagedPaths.length
      ? this.repositories.validatePaths(input.repositoryId, input.expectedStagedPaths).sort()
      : [];
    return this.git.runWriteTask(repository.path, async (run) => {
      const status = await this.repositories.status(input.repositoryId, false);
      const stagedPaths = status.changes.filter((change) => change.staged && !change.conflict).map((change) => change.path).sort();
      if (!sameStrings(stagedPaths, expectedStagedPaths)) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'prepare-commit-group', message: 'Staged changes changed after the commit plan was shown. Generate a new plan.' });
      }
      // The group's own contents are checked, not the staged patch as a whole,
      // so preparing the third commit of a plan is as protected as the first.
      const fingerprint = await this.commitGroupFingerprint(input.repositoryId, input.paths);
      if (fingerprint !== input.expectedFingerprint) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'prepare-commit-group', message: 'These files changed after the commit plan was generated. Generate a new plan.' });
      }
      const changedPaths = new Set(status.changes.filter((change) => !change.conflict).map((change) => change.path));
      if (paths.some((filePath) => !changedPaths.has(filePath))) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'prepare-commit-group', message: 'The proposed files no longer match the working tree. Generate a new plan.' });
      }
      const staged = new Set(stagedPaths);
      const targetAlreadyStaged = paths.every((filePath) => staged.has(filePath));
      if (stagedPaths.length > 0 && targetAlreadyStaged) {
        const selected = new Set(paths);
        const complement = stagedPaths.filter((filePath) => !selected.has(filePath));
        if (complement.length > 0) {
          const hasHead = await this.hasHead(repository.path);
          await run(
            hasHead
              ? ['--literal-pathspecs', 'restore', '--staged', '--', ...complement]
              : ['--literal-pathspecs', 'rm', '--cached', '-r', '--', ...complement],
            { operation: 'prepare-commit-group-unstage' },
          );
        }
      } else {
        if (stagedPaths.length > 0) {
          const hasHead = await this.hasHead(repository.path);
          await run(
            hasHead
              ? ['--literal-pathspecs', 'restore', '--staged', '--', ...stagedPaths]
              : ['--literal-pathspecs', 'rm', '--cached', '-r', '--', ...stagedPaths],
            { operation: 'prepare-commit-group-unstage' },
          );
        }
        await run(['--literal-pathspecs', 'add', '-A', '--', ...paths], { operation: 'prepare-commit-group-stage' });
      }
      return { ok: true };
    });
  }

  async resolveConflict(repositoryId: string, relativePath: string, content: string): Promise<GitResult> {
    const repository = this.repositories.get(repositoryId);
    const status = await this.repositories.status(repositoryId, false);
    const change = status.changes.find((item) => item.path === relativePath);
    if (!change?.conflict) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'resolve-conflict', message: 'The file is no longer in conflict.' });
    }
    if (/^<{7}(?: |$)/m.test(content)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'resolve-conflict', message: 'Conflict blocks still need to be resolved.' });
    }
    const [validPath] = this.repositories.validatePaths(repositoryId, [relativePath]);
    if (!validPath) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'resolve-conflict', message: 'Invalid conflict path.' });
    await writeFile(this.repositories.resolvePath(repositoryId, validPath), content, { encoding: 'utf8' });
    await this.git.runWrite(repository.path, ['--literal-pathspecs', 'add', '--', validPath], { operation: 'resolve-conflict' });
    const refreshed = await this.repositories.status(repositoryId, false);
    if (refreshed.changes.some((item) => item.path === relativePath && item.conflict)) {
      throw new GitOperationError({ code: 'UNKNOWN', operation: 'resolve-conflict', message: 'Git could not mark the file as resolved.' });
    }
    return { ok: true };
  }

  async updateConflict(repositoryId: string, relativePath: string, content: string): Promise<GitResult> {
    const status = await this.repositories.status(repositoryId, false);
    if (!status.changes.some((item) => item.path === relativePath && item.conflict)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'update-conflict', message: 'The file is no longer in conflict.' });
    }
    const [validPath] = this.repositories.validatePaths(repositoryId, [relativePath]);
    if (!validPath) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'update-conflict', message: 'Invalid conflict path.' });
    await writeFile(this.repositories.resolvePath(repositoryId, validPath), content, { encoding: 'utf8' });
    return { ok: true };
  }

  async createCommit(repositoryId: string, message: string): Promise<CommitResult> {
    await this.ensureWritable(repositoryId);
    if (typeof message !== 'string' || !message.trim() || message.length > 100_000) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'commit', message: 'Enter a valid commit message.' });
    }
    const repository = this.repositories.get(repositoryId);
    const status = await this.repositories.status(repositoryId, false);
    if (status.stagedCount === 0) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'commit', message: 'There are no staged changes.' });
    await this.git.runWrite(repository.path, ['commit', '--file=-'], { operation: 'commit', timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024, stdin: message });
    const oid = (await this.git.run(repository.path, ['rev-parse', 'HEAD'], { operation: 'commit-oid', readOnly: true })).stdout.toString('utf8').trim();
    this.rememberOid(repositoryId, oid);
    return { ok: true, oid };
  }

  async getCommitMessageContext(repositoryId: string): Promise<CommitMessageContext> {
    const repository = this.repositories.get(repositoryId);
    const status = await this.repositories.status(repositoryId, false);
    if (status.stagedCount === 0) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-staged-context', message: 'There are no staged changes to generate a message.' });
    }
    const [summaryOutput, patchOutput, historyOutput] = await Promise.all([
      this.git.run(repository.path, ['diff', '--cached', '--stat', '--no-color', '--no-ext-diff', '--no-textconv'], { operation: 'ai-staged-summary', readOnly: true, maxOutputBytes: 8 * 1024 * 1024 }),
      this.git.run(repository.path, ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3'], { operation: 'ai-staged-patch', readOnly: true, maxOutputBytes: 64 * 1024 * 1024 }),
      this.git.run(repository.path, ['log', '-10', '--format=%s'], { operation: 'ai-recent-subjects', readOnly: true, maxOutputBytes: 256 * 1024 }).catch(() => null),
    ]);
    const fullSummary = summaryOutput.stdout.toString('utf8');
    const fullPatch = patchOutput.stdout.toString('utf8');
    const summary = bounded(fullSummary, AI_SUMMARY_BUDGET);
    // Split evenly across files: a prefix cut would leave the alphabetically
    // last files with nothing but a path for the model to guess from.
    const patch = allocatePatchBudget(fullPatch, AI_PATCH_BUDGET);
    const stagedChanges = status.changes.filter((change) => change.staged && !change.conflict);
    return {
      repositoryId,
      repositoryPath: repository.path,
      branch: status.branch ?? 'detached HEAD',
      summary: summary.value,
      patch: patch.value,
      stagedPaths: stagedChanges.map((change) => change.path).sort(),
      // Grouping needs the complete file list, not the complete patch. A
      // truncated diff costs the model detail; a truncated summary would hide
      // files, which is the only case that must block a split.
      splitBlockedReason: splitBlockedReason(stagedChanges, summary.truncated),
      recentSubjects: historyOutput?.stdout.toString('utf8').split(/\r?\n/).map((value) => value.trim()).filter(Boolean) ?? [],
      fingerprint: createHash('sha256').update(fullPatch).digest('hex'),
      truncated: summary.truncated || patch.truncated,
    };
  }

  async getPullRequestDraftSnapshot(repositoryId: string, base: string) {
    const repository = this.repositories.get(repositoryId);
    const status = await this.repositories.status(repositoryId, false);
    if (status.detached || status.unborn || !status.branch || !status.oid) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-context', message: 'Check out a branch before generating a pull request draft.' });
    }
    const baseHasControl = [...base].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (!base || base.startsWith('-') || baseHasControl || /[\s~^:?*[\\]/.test(base) || base.includes('..')) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-context', message: 'The base branch is not valid.' });
    }
    let baseOid: string;
    try {
      baseOid = (await this.git.run(repository.path, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { operation: 'ai-pr-base-check', readOnly: true })).stdout.toString('utf8').trim();
    } catch {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-context', message: 'The base branch is not available locally. Fetch the remote and try again.' });
    }
    const headOid = status.oid;
    const mergeBaseOid = (await this.git.run(repository.path, ['merge-base', baseOid, headOid], { operation: 'ai-pr-merge-base', readOnly: true })).stdout.toString('utf8').trim();
    const fingerprint = createHash('sha256').update(JSON.stringify([repositoryId, status.branch, base, headOid, baseOid, mergeBaseOid])).digest('hex');
    return { repositoryId, repositoryPath: repository.path, branch: status.branch, base, headOid, baseOid, mergeBaseOid, fingerprint };
  }

  async getPullRequestDraftContext(repositoryId: string, base: string, instructions: RepositoryInstructionFile[] = []): Promise<PullRequestDraftContext> {
    const snapshot = await this.getPullRequestDraftSnapshot(repositoryId, base);
    const { repositoryPath, headOid, baseOid, mergeBaseOid } = snapshot;
    // Every command reads immutable commits, even if HEAD or the base moves meanwhile.
    const diff = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];
    const run = (args: string[], operation: string, maxOutputBytes: number) => this.git.run(repositoryPath, args, { operation, readOnly: true, maxOutputBytes });
    const [subjectsOutput, countOutput, summaryOutput, namesOutput, statsOutput, patchOutput] = await Promise.all([
      run(['log', '-z', '--max-count=30', '--format=%s', `${baseOid}..${headOid}`, '--'], 'ai-pr-subjects', 256 * 1024),
      run(['rev-list', '--count', `${baseOid}..${headOid}`, '--'], 'ai-pr-commit-count', 1024),
      run([...diff, '--stat', mergeBaseOid, headOid, '--'], 'ai-pr-summary', 8 * 1024 * 1024),
      run([...diff, '--name-status', '-z', mergeBaseOid, headOid, '--'], 'ai-pr-inventory', 8 * 1024 * 1024),
      run([...diff, '--numstat', '-z', mergeBaseOid, headOid, '--'], 'ai-pr-inventory-stats', 8 * 1024 * 1024),
      run([...diff, '--unified=3', mergeBaseOid, headOid, '--'], 'ai-pr-patch', 64 * 1024 * 1024),
    ]);
    const inventory = parseCommitFiles(namesOutput.stdout.toString('utf8'), statsOutput.stdout.toString('utf8'));
    const commitsTotal = Number(countOutput.stdout.toString('utf8').trim());
    if (!Number.isSafeInteger(commitsTotal) || commitsTotal < 0) throw new Error('Invalid commit count.');
    if (commitsTotal === 0 && inventory.length === 0) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-context', message: 'There are no changes against the base branch to describe.' });
    }
    const subjects: string[] = [];
    let subjectsSize = 0;
    for (const subject of subjectsOutput.stdout.toString('utf8').split('\0').filter(Boolean)) {
      const size = JSON.stringify(subject).length + 3;
      if (subjectsSize + size > 12_000) break;
      subjects.push(subject);
      subjectsSize += size;
    }
    const fullSummary = summaryOutput.stdout.toString('utf8');
    const marker = '\n[summary truncated by OpenTig]';
    const summaryTruncated = fullSummary.length > AI_SUMMARY_BUDGET;
    let summary = fullSummary;
    if (summaryTruncated) {
      const prefix = fullSummary.slice(0, AI_SUMMARY_BUDGET - marker.length);
      summary = prefix.slice(0, Math.max(0, prefix.lastIndexOf('\n'))) + marker;
    }
    let fullPatch = patchOutput.stdout.toString('utf8');
    const context: PullRequestDraftContext = {
      ...snapshot, subjects, summary, patch: '', truncated: false,
      coverage: {
        repositoryId, branch: snapshot.branch, base, headOid, baseOid, mergeBaseOid, contextLines: 3,
        files: inventory.map(file => ({ ...file, detail: 'inventory-only', omittedChangedLines: file.additions + file.deletions, omittedHunks: 0 })),
        commitsIncluded: subjects.length, commitsTotal, summaryTruncated,
        originalPatchCharacters: fullPatch.length, suppliedPatchCharacters: 0,
        promptCharacters: 0, promptCharacterLimit: PR_PROMPT_CHARACTER_LIMIT,
      },
    };
    // Bound metadata independently as well as the complete serialized prompt.
    // Paths stay intact: no successful draft may silently lose an inventory entry.
    if (JSON.stringify(context.coverage.files).length > 96_000) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-context', message: 'The complete file inventory is too large for a draft. Narrow the comparison or write the description manually.' });
    }
    let patchBudget = Math.min(AI_PATCH_BUDGET, PR_PROMPT_CHARACTER_LIMIT - buildPullRequestPrompt(context, instructions).length - 256);
    if (patchBudget < 0) throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-context', message: 'The complete file inventory does not fit in the draft context. Write the description manually.' });
    if (fullPatch.length > patchBudget) {
      fullPatch = (await run([...diff, '--unified=1', mergeBaseOid, headOid, '--'], 'ai-pr-compact-patch', 64 * 1024 * 1024)).stdout.toString('utf8');
      context.coverage.contextLines = 1;
    }
    for (;;) {
      const allocation = allocatePullRequestPatch(fullPatch, inventory, patchBudget);
      context.patch = allocation.value;
      context.coverage.files = allocation.files;
      context.coverage.suppliedPatchCharacters = context.patch.length;
      context.coverage.promptCharacters = buildPullRequestPrompt(context, instructions).length;
      const excess = context.coverage.promptCharacters - PR_PROMPT_CHARACTER_LIMIT;
      if (excess <= 0) break;
      patchBudget -= excess + 256;
      if (patchBudget < 0) throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-context', message: 'The complete coverage report does not fit in the draft context. Write the description manually.' });
    }
    context.truncated = summaryTruncated || subjects.length < commitsTotal || context.coverage.files.some(file => file.detail !== 'complete');
    return context;
  }

  async listCommits(repositoryId: string, cursor?: string): Promise<CommitPage> {
    const repository = this.repositories.get(repositoryId);
    if (cursor) this.assertKnownOid(repositoryId, cursor);
    const revision = cursor ?? 'HEAD';
    try {
      const [output, status] = await Promise.all([
        this.git.run(repository.path, ['log', '--topo-order', '--max-count=101', '--date=iso-strict', `--format=${LOG_FORMAT}`, revision, '--'], { operation: 'history', readOnly: true, maxOutputBytes: 8 * 1024 * 1024 }),
        this.repositories.status(repositoryId, false),
      ]);
      let commits = parseLog(output.stdout.toString('utf8'));
      if (cursor && commits[0]?.oid === cursor) commits = commits.slice(1);
      const hasMore = commits.length > 100;
      commits = commits.slice(0, 100);
      const [localOids, base] = await Promise.all([
        this.localOnlyOids(repository.path, status.upstream, status.detached || status.unborn),
        this.historyBase(repository.path, revision, status.upstream),
      ]);
      commits = commits.map((commit) => ({
        ...commit,
        isHead: commit.oid === status.oid,
        upstreamState: localOids === null ? 'unknown' : localOids.has(commit.oid) ? 'local-only' : 'published',
        baseState: base === null ? 'unknown' : base.outside.has(commit.oid) ? 'outside' : 'included',
      }));
      for (const commit of commits) this.rememberOid(repositoryId, commit.oid);
      return { commits, nextCursor: hasMore ? commits.at(-1)?.oid ?? null : null, baseRef: base?.ref ?? null };
    } catch (error) {
      if (!cursor && error instanceof GitOperationError && /does not have any commits|unknown revision|bad revision/i.test(error.message)) return { commits: [], nextCursor: null };
      throw error;
    }
  }

  async undoLatestCommit(repositoryId: string, expectedOid: string): Promise<UndoLatestCommitResult> {
    const repository = this.repositories.get(repositoryId);
    return this.git.runWriteTask(repository.path, async (run) => {
      const status = await this.repositories.status(repositoryId, false);
      if (status.operation || status.readOnly) return { status: 'blocked-operation', operation: status.operation ?? 'another Git operation' };
      if (!status.upstream) return { status: 'no-upstream' };
      if (status.detached || status.unborn || status.oid !== expectedOid) return { status: 'stale-head' };
      if (status.ahead <= 0) return { status: 'not-local' };

      const localCheck = await run(['rev-list', '--max-count=1', `${status.upstream}..${expectedOid}`], { operation: 'undo-local-check', readOnly: true });
      if (localCheck.stdout.toString('utf8').trim() !== expectedOid) return { status: 'not-local' };

      const parentLine = (await run(['rev-list', '--parents', '-n', '1', expectedOid], { operation: 'undo-parents', readOnly: true })).stdout.toString('utf8').trim();
      const [, ...parents] = parentLine.split(/\s+/).filter(Boolean);
      if (parents.length === 0) return { status: 'unsupported-root' };
      if (parents.length > 1) return { status: 'unsupported-merge' };
      const parentOid = parents[0];
      if (!parentOid) return { status: 'unsupported-root' };

      const message = (await run(['show', '-s', '--format=%B', expectedOid], { operation: 'undo-message', readOnly: true, maxOutputBytes: 256 * 1024 })).stdout.toString('utf8').trim();
      await run(['update-ref', '-m', 'OpenTig: undo local commit', 'ORIG_HEAD', expectedOid], { operation: 'undo-save-orig-head' });
      try {
        await run(['update-ref', '-m', 'OpenTig: undo local commit', 'HEAD', parentOid, expectedOid], { operation: 'undo-move-head' });
      } catch {
        return { status: 'stale-head' };
      }
      const nextStatus = await this.repositories.status(repositoryId, false);
      return { status: 'success', undoneOid: expectedOid, newHeadOid: parentOid, message, stagedCount: nextStatus.stagedCount };
    });
  }

  async branches(repositoryId: string): Promise<BranchInfo[]> {
    const repository = this.repositories.get(repositoryId);
    const output = await this.git.run(repository.path, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes'], { operation: 'branches', readOnly: true });
    return parseRefs(output.stdout);
  }

  async switchBranch(repositoryId: string, branch: string, moveChanges = false): Promise<BranchSwitchResult> {
    await this.ensureWritable(repositoryId);
    const repository = this.repositories.get(repositoryId);
    return this.git.runWriteTask(repository.path, async (run) => {
      const branches = await this.branches(repositoryId);
      const selected = branches.find((item) => item.fullName === branch)
        ?? branches.find((item) => !item.remote && item.name === branch);
      if (!selected || selected.fullName.endsWith('/HEAD')) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'switch-branch', message: 'The branch does not exist.' });
      }

      let switchArgs: string[];
      if (!selected.remote) {
        switchArgs = ['switch', selected.name];
      } else {
        const slash = selected.name.indexOf('/');
        const localName = slash >= 0 ? selected.name.slice(slash + 1) : selected.name;
        const existingLocal = branches.find((item) => !item.remote && item.name === localName);
        switchArgs = existingLocal ? ['switch', existingLocal.name] : ['switch', '--track', selected.name];
      }

      if (!moveChanges) {
        try {
          await run(switchArgs, { operation: 'switch-branch', timeoutMs: 60_000 });
          return { status: 'switched', movedChanges: false };
        } catch (error) {
          if (!(error instanceof GitOperationError) || error.detail.code !== 'DIRTY_WORKTREE') throw error;
          const status = await this.repositories.status(repositoryId, false);
          return { status: 'blocked-local-changes', files: status.changes.map((change) => change.path) };
        }
      }

      const sourceStatus = await this.repositories.status(repositoryId, false);
      if (sourceStatus.changes.length === 0) {
        await run(switchArgs, { operation: 'switch-branch', timeoutMs: 60_000 });
        return { status: 'switched', movedChanges: false };
      }

      const previousStashOid = (await run(['for-each-ref', '--format=%(objectname)', 'refs/stash'], {
        operation: 'switch-previous-stash', readOnly: true,
      })).stdout.toString('utf8').trim();
      await run([
        'stash', 'push', '--include-untracked', '--message',
        `OpenTig branch move to ${selected.name} ${new Date().toISOString()}`,
      ], { operation: 'switch-stash-changes', timeoutMs: 120_000, maxOutputBytes: 8 * 1024 * 1024 });
      const stashOid = (await run(['rev-parse', '--verify', 'refs/stash'], {
        operation: 'switch-stash-oid', readOnly: true,
      })).stdout.toString('utf8').trim();
      if (!stashOid || stashOid === previousStashOid) {
        throw new GitOperationError({
          code: 'UNKNOWN', operation: 'switch-stash-changes', message: 'Git could not safely save all local changes.',
        });
      }

      try {
        await run(switchArgs, { operation: 'switch-branch-with-changes', timeoutMs: 60_000 });
      } catch (error) {
        // Switching failed after the safety stash was created. Restore the
        // original worktree before surfacing Git's real failure.
        try {
          await run(['stash', 'apply', '--index', stashOid], {
            operation: 'switch-rollback-stash', timeoutMs: 120_000, maxOutputBytes: 16 * 1024 * 1024,
          });
          await this.dropStash(run, stashOid, 'switch-rollback-drop-stash');
        } catch {
          // The stash remains as a recovery copy if rollback itself fails.
        }
        throw error;
      }

      try {
        // Omitting --index intentionally restores staged and unstaged changes
        // together; OpenTig then clears any staged state so the destination gets
        // exactly the requested unstaged working tree.
        await run(['stash', 'apply', stashOid], {
          operation: 'switch-restore-stash', timeoutMs: 120_000, maxOutputBytes: 16 * 1024 * 1024,
        });
      } catch {
        const status = await this.repositories.status(repositoryId, false);
        const files = conflictPaths(status);
        if (files.length > 0) return { status: 'moved-with-conflicts', files, stashOid };
        return { status: 'move-restore-failed', stashOid, recoveredChanges: status.changes.length > 0 };
      }

      try {
        await run(['restore', '--staged', '--', '.'], {
          operation: 'switch-unstage-restored-changes', timeoutMs: 60_000, maxOutputBytes: 8 * 1024 * 1024,
        });
      } catch {
        const status = await this.repositories.status(repositoryId, false);
        return { status: 'move-restore-failed', stashOid, recoveredChanges: status.changes.length > 0 };
      }
      try {
        await this.dropStash(run, stashOid, 'switch-drop-stash');
      } catch {
        // The move is complete. An extra safety stash is preferable to turning
        // a successful branch switch into a misleading failure.
      }
      return { status: 'switched', movedChanges: true };
    }, repository.commonDir);
  }

  async fetch(repositoryId: string): Promise<FetchResult> {
    return this.git.withNetworkContext(this.repositories.get(repositoryId).path, () => this.fetchInContext(repositoryId));
  }

  private async fetchInContext(repositoryId: string): Promise<FetchResult> {
    const repository = this.repositories.get(repositoryId);
    try {
      await this.runFetch(repository.path, 'fetch');
    } catch (error) {
      const message = error instanceof GitOperationError
        ? error.detail.message
        : error instanceof Error ? error.message : 'Could not fetch from the remote.';
      return { status: 'failed', message };
    }
    const status = await this.repositories.status(repositoryId, false);
    return { status: 'success', ahead: status.ahead, behind: status.behind };
  }

  async pull(repositoryId: string): Promise<PullResult> {
    return this.git.withNetworkContext(this.repositories.get(repositoryId).path, () => this.pullInContext(repositoryId));
  }

  private async pullInContext(repositoryId: string): Promise<PullResult> {
    const repository = this.repositories.get(repositoryId);
    let status = await this.repositories.status(repositoryId, false);
    const existingConflicts = conflictPaths(status);
    if (existingConflicts.length > 0) return { status: 'blocked-conflicts', files: existingConflicts };
    if (status.operation) return { status: 'blocked-operation', operation: status.operation };
    if (!status.upstream) return { status: 'no-upstream' };

    await this.runFetch(repository.path, 'pull-fetch');

    status = await this.repositories.status(repositoryId, false);
    const conflictsAfterFetch = conflictPaths(status);
    if (conflictsAfterFetch.length > 0) return { status: 'blocked-conflicts', files: conflictsAfterFetch };
    if (!status.upstream) return { status: 'no-upstream' };
    if (status.behind === 0) return { status: 'up-to-date' };

    const commits = status.behind;
    const rebased = status.ahead > 0;
    const hasLocalChanges = status.changes.length > 0;
    let stashOid: string | null = null;

    if (hasLocalChanges) {
      const previousStashOid = (await this.git.run(repository.path, ['for-each-ref', '--format=%(objectname)', 'refs/stash'], {
        operation: 'pull-previous-stash',
        readOnly: true,
      })).stdout.toString('utf8').trim();
      await this.git.runWrite(repository.path, [
        'stash', 'push', '--include-untracked', '--message', `OpenTig autostash ${new Date().toISOString()}`,
      ], {
        operation: 'pull-autostash',
        timeoutMs: 120_000,
        maxOutputBytes: 8 * 1024 * 1024,
      });
      stashOid = (await this.git.run(repository.path, ['rev-parse', '--verify', 'refs/stash'], {
        operation: 'pull-autostash-oid',
        readOnly: true,
      })).stdout.toString('utf8').trim();
      if (!stashOid || stashOid === previousStashOid) {
        throw new GitOperationError({
          code: 'UNKNOWN',
          operation: 'pull-autostash',
          message: 'Git could not safely save all local changes.',
        });
      }
    }

    try {
      if (rebased) {
        await this.git.runWrite(repository.path, ['rebase', '@{upstream}'], {
          operation: 'pull-rebase',
          timeoutMs: 120_000,
          maxOutputBytes: 16 * 1024 * 1024,
        });
      } else {
        await this.git.runWrite(repository.path, ['merge', '--ff-only', '--no-edit', '@{upstream}'], {
          operation: 'pull-fast-forward',
          timeoutMs: 120_000,
          maxOutputBytes: 16 * 1024 * 1024,
        });
      }
    } catch (error) {
      const statusAfter = await this.repositories.status(repositoryId, false);
      const files = conflictPaths(statusAfter);
      if (statusAfter.operation === 'rebase') await this.abortRebase(repository.path);
      if (stashOid) {
        const restored = await this.restoreAutostash(repositoryId, stashOid, false);
        if (restored) return restored;
      }
      if (rebased) return { status: 'rebase-conflict', files };
      throw error;
    }

    if (stashOid) {
      const restored = await this.restoreAutostash(repositoryId, stashOid, true);
      if (restored) return restored;
    }
    const nextStatus = await this.repositories.status(repositoryId, false);
    return { status: 'success', commits, restoredLocalChanges: hasLocalChanges, rebased, localCommits: nextStatus.ahead };
  }

  async push(repositoryId: string, publish?: PublishBranchOptions, expectedContext?: string): Promise<PushResult> {
    if (this.access) return this.pushWithContext(repositoryId, publish, expectedContext);
    return this.legacyPush(repositoryId, publish);
  }

  private async pushWithContext(repositoryId: string, publish?: PublishBranchOptions, expectedContext?: string): Promise<PushResult> {
    const repository = this.repositories.get(repositoryId);
    try {
      const reviewed = await this.access!.assertPublication(repositoryId, expectedContext, publish?.remote);
      return await this.git.withNetworkContext(repository.path, () => this.git.runWriteTask(repository.path, async run => {
        const context = await this.access!.assertPublication(repositoryId, reviewed.id, publish?.remote);
        const status = await this.repositories.status(repositoryId, false);
        const conflicts = conflictPaths(status);
        if (conflicts.length) return { status: 'blocked-conflicts', files: conflicts };
        if (status.operation) return { status: 'blocked-operation', operation: status.operation };
        if (!context.branch || !context.oid || !context.targetRef) return { status: 'rejected', reason: 'configuration', message: 'Check out a branch with a commit before publishing.' };
        if (publish && (publish.expectedBranch !== context.branch || publish.expectedOid !== context.oid)) return { status: 'rejected', reason: 'configuration', message: 'The branch changed. Review and try again.' };
        if (!context.remote) return context.remotes.length ? { status: 'remote-required', branch: context.branch, oid: context.oid, remotes: context.remotes }
          : { status: 'rejected', reason: 'configuration', message: 'No remote is configured.' };
        const result = await run(['-c', `remote.${context.remote}.mirror=false`, 'push', '--porcelain', '--no-follow-tags',
          ...(!status.upstream ? ['--set-upstream'] : []), '--', context.remote, `refs/heads/${context.branch}:${context.targetRef}`], {
          operation: 'push', timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024,
          publication: { repositoryId, id: context.id, ...(publish?.remote ? { remote: publish.remote } : {}) },
        });
        if (!status.upstream) return { status: 'published', branch: context.branch, remote: context.remote };
        return result.stdout.toString('utf8').includes('[up to date]') ? { status: 'up-to-date' } : { status: 'success', commits: status.ahead };
      }, repository.commonDir));
    } catch (error) { return pushFailure(error); }
  }

  private async legacyPush(repositoryId: string, publish?: PublishBranchOptions): Promise<PushResult> {
    const repository = this.repositories.get(repositoryId);
    let status = await this.repositories.status(repositoryId, false);
    const existingConflicts = conflictPaths(status);
    if (existingConflicts.length > 0) return { status: 'blocked-conflicts', files: existingConflicts };
    if (status.operation) return { status: 'blocked-operation', operation: status.operation };
    if (!status.upstream || publish) return this.publishBranch(repositoryId, status.branch, status.oid, publish);
    if (status.ahead === 0) return { status: 'up-to-date' };

    try {
      await this.runFetch(repository.path, 'push-fetch');
    } catch (error) {
      return pushFailure(error);
    }

    status = await this.repositories.status(repositoryId, false);
    const conflictsAfterFetch = conflictPaths(status);
    if (conflictsAfterFetch.length > 0) return { status: 'blocked-conflicts', files: conflictsAfterFetch };
    if (status.operation) return { status: 'blocked-operation', operation: status.operation };
    if (!status.upstream) return { status: 'no-upstream' };
    if (status.ahead === 0) return { status: 'up-to-date' };
    if (status.behind > 0) return { status: 'diverged', ahead: status.ahead, behind: status.behind };

    const commits = status.ahead;
    try {
      await this.git.runWrite(repository.path, ['push', '--porcelain'], {
        operation: 'push',
        timeoutMs: 120_000,
        maxOutputBytes: 16 * 1024 * 1024,
      });
    } catch (error) {
      return pushFailure(error);
    }
    return { status: 'success', commits };
  }

  private async publishBranch(repositoryId: string, expectedBranch: string | null, expectedOid: string | null, publish?: PublishBranchOptions): Promise<PushResult> {
    const repository = this.repositories.get(repositoryId);
    const rejected = (message: string): PushResult => ({ status: 'rejected', reason: 'configuration', message });
    return this.git.runWriteTask(repository.path, async (run): Promise<PushResult> => {
      const status = await this.repositories.status(repositoryId, false);
      if (status.operation || status.readOnly) return { status: 'blocked-operation', operation: status.operation ?? 'another Git operation' };
      const conflicts = conflictPaths(status);
      if (conflicts.length > 0) return { status: 'blocked-conflicts', files: conflicts };
      if (status.detached || !status.branch) return rejected('Check out a branch before publishing.');
      if (status.unborn || !status.oid) return rejected('Create the first commit before publishing this branch.');
      if (status.upstream || status.branch !== (publish?.expectedBranch ?? expectedBranch) || status.oid !== (publish?.expectedOid ?? expectedOid)) {
        return rejected('The branch changed. Refresh and try publishing again.');
      }
      try {
        const remotes = (await run(['remote'], { operation: 'publish-remotes', readOnly: true })).stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
        if (remotes.length === 0) return rejected('No remote is configured. Add a remote before publishing this branch.');
        let remote = publish?.remote;
        if (!remote) {
          for (const key of [`branch.${status.branch}.pushRemote`, 'remote.pushDefault', `branch.${status.branch}.remote`]) {
            try {
              remote = (await run(['config', '--get', key], { operation: 'publish-remote-config', readOnly: true })).stdout.toString('utf8').trim();
            } catch (error) {
              if (!(error instanceof GitOperationError) || error.detail.exitCode !== 1) throw error;
            }
            if (remote) break;
          }
          remote ||= remotes.length === 1 ? remotes[0] : undefined;
        }
        if (!remote) return { status: 'remote-required', branch: status.branch, oid: status.oid, remotes };
        if (!remotes.includes(remote)) return rejected('The selected push remote is not configured. Check the repository remote settings.');
        const ref = `refs/heads/${status.branch}`;
        // An explicit refspec publishes only this branch, independent of push.default,
        // remote push refspecs, mirror mode, or automatic tag following.
        await run(['-c', `remote.${remote}.mirror=false`, 'push', '--porcelain', '--set-upstream', '--no-follow-tags', '--', remote, `${ref}:${ref}`], {
          operation: 'publish-branch', timeoutMs: 120_000, maxOutputBytes: 16 * 1024 * 1024,
        });
        return { status: 'published', branch: status.branch, remote };
      } catch (error) {
        return pushFailure(error);
      }
    }, repository.commonDir);
  }

  async worktrees(repositoryId: string): Promise<WorktreeInfo[]> {
    const repository = this.repositories.get(repositoryId);
    const output = await this.git.run(repository.path, ['worktree', 'list', '--porcelain', '-z'], { operation: 'worktrees', readOnly: true });
    return parseWorktrees(output.stdout);
  }

  private async findWorktree(repositoryId: string, targetPath: string): Promise<WorktreeInfo | undefined> {
    const target = await normalizePath(targetPath);
    for (const worktree of await this.worktrees(repositoryId)) {
      if (await normalizePath(worktree.path) === target) return worktree;
    }
    return undefined;
  }

  async selectWorktree(repositoryId: string, targetPath: string) {
    const worktree = await this.findWorktree(repositoryId, targetPath);
    if (!worktree || worktree.locked || worktree.prunable || worktree.bare) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'select-worktree', message: 'The worktree is unavailable.' });
    }
    return this.repositories.openPath(worktree.path);
  }

  /**
   * Cheap enumeration for the refs manager. Deliberately runs no status
   * scan per worktree so ordinary refreshes stay as fast as the selectors.
   */
  async localRefsSnapshot(repositoryId: string): Promise<LocalRefsSnapshot> {
    const repository = this.repositories.get(repositoryId);
    const [branches, worktrees] = await Promise.all([this.branches(repositoryId), this.worktrees(repositoryId)]);
    const managed = await this.remoteBranches.snapshotBranches(repositoryId, branches);
    return {
      branches: managed.branches.sort(compareBranches),
      remotes: managed.remotes,
      worktrees: await Promise.all(worktrees.map(async (worktree) => ({ ...worktree, current: await samePath(worktree.path, repository.path) }))),
    };
  }

  async branchDetails(repositoryId: string, fullName: string): Promise<BranchDetails> {
    const repository = this.repositories.get(repositoryId);
    // Resolve the target from fresh Git data; renderer input never reaches Git.
    const branch = (await this.branches(repositoryId)).find((item) => !item.remote && item.fullName === fullName);
    if (!branch) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'branch-details', message: 'The branch no longer exists.' });

    const base = {
      fullName: branch.fullName, name: branch.name, oid: branch.oid, shortOid: branch.shortOid,
      subject: branch.subject, author: branch.author, date: branch.date,
      upstream: branch.upstream, ahead: branch.ahead, behind: branch.behind,
      worktreePath: branch.worktreePath,
    };
    if (branch.current) return { ...base, deletion: 'current', comparisonKind: 'none', comparisonBase: null, uniqueCommits: 0 };
    if (branch.worktreePath) return { ...base, deletion: 'checked-out', comparisonKind: 'none', comparisonBase: null, uniqueCommits: 0 };

    const comparison = await this.comparisonBase(repository.path, branch.upstream);
    if (!comparison.resolved) {
      return { ...base, deletion: 'unknown', comparisonKind: comparison.kind, comparisonBase: comparison.label, uniqueCommits: 0 };
    }
    const [merged, unique] = await Promise.all([
      this.isAncestor(repository.path, branch.fullName, comparison.ref),
      this.countCommits(repository.path, comparison.ref, branch.fullName),
    ]);
    return {
      ...base,
      deletion: merged ? 'safe' : 'unmerged',
      comparisonKind: comparison.kind,
      comparisonBase: comparison.label,
      uniqueCommits: unique,
    };
  }

  async worktreeDetails(repositoryId: string, targetPath: string): Promise<WorktreeDetails> {
    const repository = this.repositories.get(repositoryId);
    const worktree = await this.findWorktree(repositoryId, targetPath);
    if (!worktree) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'worktree-details', message: 'The worktree no longer exists.' });

    const details: WorktreeDetails = {
      path: worktree.path, oid: worktree.oid, branch: worktree.branch, main: worktree.main,
      current: await samePath(worktree.path, repository.path), detached: worktree.detached, bare: worktree.bare,
      locked: worktree.locked, prunable: worktree.prunable,
      available: !worktree.bare && !worktree.prunable,
      stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 0,
      operation: null, readOnly: false, lastCommit: null,
    };
    // Never run Git inside a directory Git already reports as missing or bare.
    if (!details.available) return details;

    const [counts, operation, lastCommit] = await Promise.all([
      this.worktreeChangeCounts(worktree.path),
      this.repositories.operationAt(worktree.path).catch(() => null),
      this.lastCommit(repository.path, worktree.oid),
    ]);
    return { ...details, ...counts, operation, readOnly: operation !== null, lastCommit };
  }

  /** Re-resolves every branch under the common write lock before safe or forced deletion. */
  async deleteLocalBranch(repositoryId: string, fullName: string, expectedOid: string, force = false): Promise<BranchDeletionResult> {
    const repository = this.repositories.get(repositoryId);
    return this.git.runWriteTask(repository.path, async (run) => {
      const branch = (await this.branches(repositoryId)).find((item) => !item.remote && item.fullName === fullName);
      if (!branch) return { status: 'missing' };
      if (branch.oid !== expectedOid) return { status: 'stale' };
      if (branch.current) return { status: 'current' };
      if (branch.worktreePath) return { status: 'checked-out', worktreePath: branch.worktreePath };

      if (!force) {
        const comparison = await this.comparisonBase(repository.path, branch.upstream);
        if (!comparison.resolved) return { status: 'unknown', comparisonBase: comparison.label };
        if (!await this.isAncestor(repository.path, branch.fullName, comparison.ref)) {
          return { status: 'unmerged', comparisonBase: comparison.label, uniqueCommits: await this.countCommits(repository.path, comparison.ref, branch.fullName) };
        }
      }

      await run(['branch', '--delete', ...(force ? ['--force'] : []), '--', branch.name], { operation: 'delete-branch', timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 });
      return { status: 'deleted', fullName: branch.fullName, name: branch.name, oid: branch.oid };
    }, repository.commonDir);
  }

  /**
   * Removes an unlocked, non-current linked worktree. Dirty state requires an
   * explicit force flag; its branch is preserved unless separately requested.
   */
  async removeWorktree(repositoryId: string, targetPath: string, expectedOid: string, force = false, deleteBranch = false): Promise<WorktreeRemovalResult> {
    const repository = this.repositories.get(repositoryId);
    return this.git.runWriteTask(repository.path, async (run) => {
      const worktree = await this.findWorktree(repositoryId, targetPath);
      if (!worktree) return { status: 'missing' };
      if (worktree.oid !== expectedOid) return { status: 'stale' };
      if (worktree.main) return { status: 'main' };
      if (await samePath(worktree.path, repository.path)) return { status: 'current' };
      if (worktree.bare) return { status: 'bare' };
      if (worktree.locked) return { status: 'locked', reason: worktree.locked };
      if (worktree.prunable) return { status: 'prunable', reason: worktree.prunable };

      const [counts, operation] = await Promise.all([
        this.worktreeChangeCounts(worktree.path),
        this.repositories.operationAt(worktree.path).catch(() => null),
      ]);
      const dirty = counts.stagedCount + counts.unstagedCount + counts.untrackedCount + counts.conflictCount > 0;
      if ((dirty || operation) && !force) return { status: 'dirty', ...counts, operation };

      await run(['-c', 'core.longpaths=true', 'worktree', 'remove', ...(force ? ['--force'] : []), '--', worktree.path], { operation: 'remove-worktree', timeoutMs: 60_000, maxOutputBytes: 4 * 1024 * 1024 });
      if (deleteBranch && worktree.branch) {
        await run(['branch', '--delete', '--force', '--', worktree.branch], { operation: 'remove-worktree-branch', timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 });
      }
      // Only after Git succeeded does OpenTig forget the directory.
      const recentRepositories = await this.repositories.forgetWorktree(worktree.path);
      return { status: 'removed', path: worktree.path, branch: worktree.branch, recentRepositories };
    }, repository.commonDir);
  }

  /**
   * The ref a merged check compares against: the configured upstream when it
   * resolves locally, otherwise `HEAD` only when no upstream is configured. A
   * configured-but-missing upstream stays unresolved instead of silently
   * falling back to a base the user was not promised.
   */
  private async comparisonBase(root: string, upstream: string | null): Promise<{ ref: string; label: string; kind: BranchComparisonKind; resolved: boolean }> {
    if (upstream) {
      const resolved = await this.resolves(root, upstream);
      return { ref: upstream, label: upstream, kind: 'upstream', resolved };
    }
    return { ref: 'HEAD', label: 'HEAD', kind: 'head', resolved: await this.resolves(root, 'HEAD') };
  }

  private async resolves(root: string, ref: string): Promise<boolean> {
    try {
      await this.git.run(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { operation: 'verify-comparison-base', readOnly: true, maxOutputBytes: 64 * 1024 });
      return true;
    } catch {
      return false;
    }
  }

  private async isAncestor(root: string, branchRef: string, base: string): Promise<boolean> {
    try {
      await this.git.run(root, ['merge-base', '--is-ancestor', branchRef, base], { operation: 'branch-merged-check', readOnly: true, maxOutputBytes: 64 * 1024 });
      return true;
    } catch {
      return false;
    }
  }

  private async countCommits(root: string, base: string, branchRef: string): Promise<number> {
    try {
      const output = await this.git.run(root, ['rev-list', '--count', `${base}..${branchRef}`], { operation: 'branch-unique-commits', readOnly: true, maxOutputBytes: 64 * 1024 });
      const count = Number(output.stdout.toString('utf8').trim());
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    } catch {
      return 0;
    }
  }

  private async worktreeChangeCounts(worktreePath: string): Promise<{ stagedCount: number; unstagedCount: number; untrackedCount: number; conflictCount: number }> {
    try {
      const output = await this.git.run(worktreePath, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], {
        operation: 'worktree-status', readOnly: true, maxOutputBytes: 32 * 1024 * 1024,
      });
      const status = parseStatus(output.stdout);
      return {
        stagedCount: status.stagedCount,
        unstagedCount: status.unstagedCount,
        untrackedCount: status.changes.filter((change) => change.kind === 'untracked').length,
        conflictCount: status.changes.filter((change) => change.conflict).length,
      };
    } catch {
      // An unreadable worktree must never look clean enough to remove.
      return { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictCount: 1 };
    }
  }

  private async lastCommit(root: string, oid: string): Promise<CommitSummary | null> {
    if (!/^[0-9a-f]{7,64}$/i.test(oid)) return null;
    try {
      const output = await this.git.run(root, ['show', '--no-patch', '--date=iso-strict', '--format=%H%x00%h%x00%s%x00%an%x00%cd', oid], {
        operation: 'worktree-last-commit', readOnly: true, maxOutputBytes: 256 * 1024,
      });
      const [commitOid, shortOid, subject, author, date] = output.stdout.toString('utf8').split('\0');
      if (!commitOid) return null;
      return { oid: commitOid, shortOid: shortOid ?? '', subject: subject ?? '', author: author ?? '', date: (date ?? '').trim() };
    } catch {
      return null;
    }
  }

  private async untrackedDiff(repositoryId: string, relativePath: string): Promise<DiffResult> {
    const file = await this.files.read(repositoryId, relativePath, true);
    if (file.binary) return { patch: '', path: relativePath, binary: true, truncated: file.tooLarge, lineCount: 0 };
    const normalized = file.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const escaped = relativePath.replace(/"/g, '\\"');
    const body = lines.map((line) => `+${line}`).join('\n');
    const patch = `diff --git a/${escaped} b/${escaped}\nnew file mode 100644\n--- /dev/null\n+++ b/${escaped}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
    return { patch, path: relativePath, binary: false, truncated: file.tooLarge, lineCount: lines.length };
  }

  /**
   * Fingerprints the working-tree contents of one commit group. Deliberately
   * independent of the index and of HEAD: committing one group of a plan must
   * not invalidate the fingerprints of the groups still waiting, which is what
   * lets every commit in a plan keep its own staleness check.
   */
  async commitGroupFingerprint(repositoryId: string, relativePaths: string[]): Promise<string> {
    const repository = this.repositories.get(repositoryId);
    const paths = this.repositories.validatePaths(repositoryId, relativePaths).sort();
    const hash = createHash('sha256');
    for (const relativePath of paths) {
      hash.update(relativePath);
      hash.update('\0');
      hash.update(await this.blobHash(repository.path, relativePath));
      hash.update('\n');
    }
    return hash.digest('hex');
  }

  /** Content id of a working-tree file, or a marker when it no longer exists. */
  private async blobHash(root: string, relativePath: string): Promise<string> {
    try {
      const absolute = path.resolve(root, relativePath);
      if (!(await stat(absolute)).isFile()) return 'not-a-file';
      const output = await this.git.run(root, ['hash-object', '--', absolute], { operation: 'commit-group-fingerprint', readOnly: true });
      return output.stdout.toString('utf8').trim() || 'unknown';
    } catch {
      return 'missing';
    }
  }

  private async hasHead(root: string): Promise<boolean> {
    try { await this.git.run(root, ['rev-parse', '--verify', 'HEAD'], { operation: 'verify-head', readOnly: true }); return true; } catch { return false; }
  }

  private async ensureWritable(repositoryId: string): Promise<void> {
    const status = await this.repositories.status(repositoryId, false);
    if (status.readOnly) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'write', message: `The repository is in the middle of ${status.operation}; OpenTig keeps it read-only.` });
  }

  private async historyBase(repositoryPath: string, revision: string, upstream: string | null): Promise<{ ref: string; outside: Set<string> } | null> {
    try {
      const options = { operation: 'history-base', readOnly: true, maxOutputBytes: 8 * 1024 * 1024 };
      const refs = await this.git.run(repositoryPath, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', 'refs/heads/main', 'refs/heads/master', 'refs/remotes'], options);
      const base = selectHistoryBase(refs.stdout.toString('utf8'), upstream);
      if (!base) return null;
      const output = await this.git.run(repositoryPath, ['rev-list', revision, `^${base.oid}`, '--'], options);
      return { ref: base.ref, outside: new Set(output.stdout.toString('utf8').trim().split('\n').filter(Boolean)) };
    } catch {
      // An unavailable/stale default ref must not block history or imply membership.
      return null;
    }
  }

  private async localOnlyOids(repositoryPath: string, upstream: string | null, unavailable: boolean): Promise<Set<string> | null> {
    if (!upstream || unavailable) return null;
    try {
      const output = await this.git.run(repositoryPath, ['rev-list', '@{upstream}..HEAD'], { operation: 'history-local-commits', readOnly: true, maxOutputBytes: 8 * 1024 * 1024 });
      const values = output.stdout.toString('utf8').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      if (!values.every((value) => /^[0-9a-f]{40,64}$/i.test(value))) return null;
      return new Set(values);
    } catch {
      return null;
    }
  }

  private async runFetch(repositoryPath: string, operation: string): Promise<void> {
    await this.git.runWrite(repositoryPath, ['fetch'], {
      operation,
      timeoutMs: 120_000,
      maxOutputBytes: 8 * 1024 * 1024,
    });
  }

  private async abortRebase(repositoryPath: string): Promise<void> {
    try {
      await this.git.runWrite(repositoryPath, ['rebase', '--abort'], {
        operation: 'pull-rebase-abort',
        timeoutMs: 60_000,
        maxOutputBytes: 4 * 1024 * 1024,
      });
    } catch {
      // Leaving a rebase in progress would lock the worktree; a failed abort is still reported by status.
    }
  }

  private async restoreAutostash(repositoryId: string, stashOid: string, updated: boolean): Promise<Extract<PullResult, { status: 'stash-conflict' | 'restore-failed' }> | null> {
    const repository = this.repositories.get(repositoryId);
    try {
      await this.git.runWrite(repository.path, ['stash', 'apply', '--index', stashOid], {
        operation: 'pull-restore-stash',
        timeoutMs: 120_000,
        maxOutputBytes: 16 * 1024 * 1024,
      });
    } catch {
      let status = await this.repositories.status(repositoryId, false);
      let files = conflictPaths(status);
      if (files.length > 0) return { status: 'stash-conflict', files, stashOid, updated };
      if (status.changes.length > 0) return { status: 'restore-failed', stashOid, updated, recoveredChanges: true };

      // Git can reject --index before touching the worktree when the saved index
      // no longer applies to the updated HEAD. Retrying without --index lets Git
      // perform its normal three-way restoration and materialize real conflicts.
      try {
        await this.git.runWrite(repository.path, ['stash', 'apply', stashOid], {
          operation: 'pull-restore-stash-fallback',
          timeoutMs: 120_000,
          maxOutputBytes: 16 * 1024 * 1024,
        });
      } catch {
        status = await this.repositories.status(repositoryId, false);
        files = conflictPaths(status);
        if (files.length > 0) return { status: 'stash-conflict', files, stashOid, updated };
        return { status: 'restore-failed', stashOid, updated, recoveredChanges: status.changes.length > 0 };
      }
    }

    try {
      const list = (await this.git.run(repository.path, ['stash', 'list', '--format=%H%x09%gd'], {
        operation: 'pull-find-stash',
        readOnly: true,
      })).stdout.toString('utf8');
      const selector = list.split(/\r?\n/).map((line) => line.split('\t')).find(([oid]) => oid === stashOid)?.[1];
      if (selector) {
        await this.git.runWrite(repository.path, ['stash', 'drop', selector], {
          operation: 'pull-drop-stash',
          maxOutputBytes: 4 * 1024 * 1024,
        });
      }
    } catch {
      // The working tree is restored; keeping an extra recovery stash is safe.
    }
    return null;
  }

  private async dropStash(run: GitTaskRunner, stashOid: string, operation: string): Promise<void> {
    const list = (await run(['stash', 'list', '--format=%H%x09%gd'], {
      operation: `${operation}-find`, readOnly: true,
    })).stdout.toString('utf8');
    const selector = list.split(/\r?\n/).map((line) => line.split('\t')).find(([oid]) => oid === stashOid)?.[1];
    if (selector) {
      await run(['stash', 'drop', selector], { operation, maxOutputBytes: 4 * 1024 * 1024 });
    }
  }

  private rememberOid(repositoryId: string, oid: string): void {
    const known = this.knownOids.get(repositoryId) ?? new Set<string>();
    known.add(oid);
    this.knownOids.set(repositoryId, known);
  }

  private assertKnownOid(repositoryId: string, oid: string): void {
    if (!/^[0-9a-f]{40,64}$/i.test(oid) || !this.knownOids.get(repositoryId)?.has(oid)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'oid', message: 'Commit not recognized.' });
    }
  }
}

/** The checked-out branch stays first; the rest sort by name for a stable list. */
function compareBranches(left: BranchInfo, right: BranchInfo): number {
  if (left.current !== right.current) return left.current ? -1 : 1;
  return left.name.localeCompare(right.name, 'en', { sensitivity: 'base', numeric: true });
}

/** Worktree paths compare by resolved form, ignoring Windows casing. */
async function samePath(left: string, right: string): Promise<boolean> {
  return await normalizePath(left) === await normalizePath(right);
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function normalizePath(value: string): Promise<string> {
  let existing = path.resolve(value);
  const missing: string[] = [];
  for (;;) {
    try {
      const resolved = path.join(await realpath(existing), ...missing);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      const parent = path.dirname(existing);
      if (parent === existing) return process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
      // Missing/prunable worktrees still need their existing parent canonicalized.
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

function conflictPaths(status: Awaited<ReturnType<RepositoryService['status']>>): string[] {
  return status.changes.filter((change) => change.conflict).map((change) => change.path);
}

/**
 * Explains why a commit split cannot be offered, or null when it can. A split
 * stages whole files, so any file that is only partially staged, or whose
 * identity changed through a rename or copy, would be committed with content the
 * user never chose.
 */
function splitBlockedReason(stagedChanges: FileChange[], summaryTruncated: boolean): string | null {
  if (stagedChanges.length < 2) return null;
  if (summaryTruncated) return 'There are too many staged files to plan a reliable split.';
  const partial = stagedChanges.find((change) => change.unstaged);
  if (partial) return `${partial.path} is only partially staged, so it cannot be grouped by file.`;
  const moved = stagedChanges.find((change) => change.kind === 'renamed' || change.kind === 'copied');
  if (moved) return `${moved.path} was renamed or copied, so splitting could commit it in the wrong order.`;
  return null;
}

function bounded(value: string, limit: number): { value: string; truncated: boolean } {
  if (value.length <= limit) return { value, truncated: false };
  return { value: `${value.slice(0, limit)}\n[content truncated by OpenTig]`, truncated: true };
}

export function pushFailure(error: unknown): Extract<PushResult, { status: 'rejected' }> {
  const detail = error instanceof GitOperationError ? error.detail : null;
  const message = redactSensitiveText(detail?.stderr || detail?.message || (error instanceof Error ? error.message : 'Git rejected the push.')).trim().slice(0, 3000);
  const raw = message.toLowerCase();
  let reason: Extract<PushResult, { status: 'rejected' }>['reason'] = 'unknown';
  let explanation = '';
  if (/repository not found|repository .* not found|(?:http|error:)\s*404/.test(raw)) { reason = 'inaccessible'; explanation = 'The repository is missing or inaccessible to this account. '; }
  else if (/authentication failed|could not read username|bad credentials|expired|revoked|no usable saved credentials|publickey|(?:http|error:)\s*401/.test(raw)) reason = 'authentication';
  else if (/protected branch|hook declined|pre-receive hook|remote rejected|gh006|gh013|repository rule/.test(raw)) reason = 'hook';
  else if (/permission.*denied|write access.*not granted|access denied|(?:http|error:)\s*403/.test(raw)) reason = 'permission';
  else if (/non-fast-forward|fetch first|stale info/.test(raw)) reason = 'remote-changed';
  else if (/could not resolve host|unable to access|connection.*(timed out|reset|refused)|network is unreachable|(?:http|error:)\s*50[0-4]/.test(raw)) reason = 'network';
  else if (detail?.code === 'INVALID_ARGUMENT' || /upstream branch .* does not match|no upstream branch|push\.default|context|account changed/.test(raw)) reason = 'configuration';
  return { status: 'rejected', reason, message: explanation + message };
}

function makeDiffResult(path: string, buffer: Buffer): DiffResult {
  const patch = buffer.toString('utf8');
  const binary = /Binary files .* differ|GIT binary patch/.test(patch);
  const lineCount = patch ? patch.split('\n').length : 0;
  return { patch, path, binary, truncated: false, lineCount };
}
