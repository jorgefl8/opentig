import { z } from 'zod';
import type { CreateReleaseInput, DeleteDraftReleaseInput, ReleaseDetails, ReleaseSummary, UpdateReleaseInput } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';
import { redactCommandToken } from './GitHubAccountAuth';
import { classifyActionFailure } from './GitHubActionErrors';
import { beginGitHubMutation, withPrivateTextFile, type GitHubAccess, type GitHubTarget } from './GitHubAccess';
import { parseReleaseDetails, parseReleaseList, RELEASE_DETAIL_FIELDS, RELEASE_SUMMARY_FIELDS } from './ReleaseParser';

const READ_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 60_000;
const repositoryFactsSchema = z.object({ default_branch: z.string().nullish(), permissions: z.object({ push: z.boolean().nullish() }).nullish() });

/** OpenTig never creates or moves a tag: a release only ever points at one that already exists. */
export class GitHubReleases {
  constructor(private readonly github: GitHubAccess) {}

  private readOptions(target: GitHubTarget, operation: string) {
    return { auth: target.auth, executable: target.executable, cwd: target.repository.path, operation, timeoutMs: READ_TIMEOUT_MS, maxOutputBytes: 4 * 1024 * 1024 };
  }

  private async read(target: GitHubTarget, args: string[], operation: string) {
    try {
      return (await this.github.runRead(args, this.readOptions(target, operation))).stdout;
    } catch (error) {
      if (error instanceof GhOperationError && /unknown json field/i.test(error.message)) {
        throw new GhOperationError({ code: 'GH_CLI_INCOMPATIBLE', operation, message: 'Reading releases needs a newer GitHub CLI. Update gh and try again.' });
      }
      throw error;
    }
  }

  async list(repositoryId: string): Promise<ReleaseSummary[]> {
    const operation = 'gh-release-list';
    return this.listFor(await this.github.requireGitHub(repositoryId, operation), operation);
  }

  private async listFor(target: GitHubTarget, operation: string): Promise<ReleaseSummary[]> {
    return parseReleaseList(await this.read(target, ['release', 'list', '-R', target.nameWithOwner, '--limit', '50', '--json', RELEASE_SUMMARY_FIELDS], operation));
  }

  async view(repositoryId: string, tagName: string): Promise<ReleaseDetails> {
    const operation = 'gh-release-view';
    return this.viewFor(await this.github.requireGitHub(repositoryId, operation), tagName, operation);
  }

  private async viewFor(target: GitHubTarget, tagName: string, operation: string): Promise<ReleaseDetails> {
    const [raw, list, tagExists, facts] = await Promise.all([
      this.read(target, ['release', 'view', tagName, '-R', target.nameWithOwner, '--json', RELEASE_DETAIL_FIELDS], operation),
      this.listFor(target, operation),
      this.tagExists(target, tagName, operation),
      this.repositoryFacts(target, operation),
    ]);
    return parseReleaseDetails(raw, { isLatest: list.some((release) => release.tagName === tagName && release.isLatest), tagExists, viewerCanWrite: facts.canWrite });
  }

  /** Only a 404 says the tag doesn't exist. Any other failure leaves the question open, so it isn't an answer. */
  private async tagExists(target: GitHubTarget, tagName: string, operation: string): Promise<boolean> {
    const path = tagName.split('/').map(encodeURIComponent).join('/');
    const result = await this.github.run(target.executable, ['api', `repos/${target.nameWithOwner}/git/ref/tags/${path}`], this.readOptions(target, operation));
    if (result.exitCode === 0) return true;
    if (/\(HTTP 404\)\s*$/im.test(result.stderr)) return false;
    throw classifyActionFailure({ ...result, stderr: redactCommandToken(result.stderr, target.auth) }, operation);
  }

  private async repositoryFacts(target: GitHubTarget, operation: string): Promise<{ canWrite: boolean; defaultBranch: string | null }> {
    let json: unknown;
    try { json = JSON.parse(await this.read(target, ['api', `repos/${target.nameWithOwner}`], operation)); } catch (error) { if (error instanceof GhOperationError) throw error; }
    const parsed = repositoryFactsSchema.safeParse(json);
    if (!parsed.success) throw new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub returned unreadable repository data.' });
    return { canWrite: parsed.data.permissions?.push === true, defaultBranch: parsed.data.default_branch ?? null };
  }

  private notAllowed(operation: string, message: string) {
    return new GhOperationError({ code: 'GH_PR_ACTION_NOT_ALLOWED', operation, message });
  }

  private changed(operation: string, message: string) {
    return new GhOperationError({ code: 'GH_PR_STATE_CHANGED', operation, message });
  }

  private async act(target: GitHubTarget, args: string[], operation: string): Promise<void> {
    const result = await this.github.run(target.executable, args, { ...this.readOptions(target, operation), timeoutMs: ACTION_TIMEOUT_MS });
    if (result.exitCode !== 0) throw classifyActionFailure({ ...result, stderr: redactCommandToken(result.stderr, target.auth) }, operation);
  }

  async create(input: CreateReleaseInput): Promise<void> {
    const operation = 'gh-release-create';
    const { target, verifyAccount } = await beginGitHubMutation(this.github, input, operation);
    this.github.invalidate(input.repositoryId);
    const [facts, tagExists, releases] = await Promise.all([this.repositoryFacts(target, operation), this.tagExists(target, input.tagName, operation), this.listFor(target, operation)]);
    if (!facts.canWrite) throw this.notAllowed(operation, "This GitHub account doesn't have write access to this repository.");
    if (!tagExists) throw this.notAllowed(operation, `The tag ${input.tagName} doesn't exist on GitHub. OpenTig doesn't create tags, so create and push it first.`);
    // `gh` doesn't check this for drafts, and would then pick whichever release it finds first.
    if (releases.some((release) => release.tagName === input.tagName)) throw this.notAllowed(operation, `A release for ${input.tagName} already exists. Edit that one instead.`);
    verifyAccount();
    try {
      await withPrivateTextFile(input.notes, (notesFile) => this.act(target, [
        'release', 'create', input.tagName, '-R', target.nameWithOwner, '--draft', '--verify-tag', '--title', input.title, '--notes-file', notesFile,
        ...(input.generateNotes ? ['--generate-notes'] : []), ...(input.prerelease ? ['--prerelease'] : []),
      ], operation));
    } finally {
      this.github.invalidate(input.repositoryId);
    }
  }

  /** Workflows also write to release notes, so an edit only goes through over the exact text it started from. */
  async update(input: UpdateReleaseInput): Promise<void> {
    const operation = 'gh-release-update';
    const { target, verifyAccount } = await beginGitHubMutation(this.github, input, operation);
    this.github.invalidate(input.repositoryId);
    const release = await this.viewFor(target, input.tagName, operation);
    if (release.databaseId !== input.expectedDatabaseId || release.bodyHash !== input.expectedBodyHash) throw this.changed(operation, 'This release changed on GitHub after you started editing. Your changes were not saved.');
    if (!release.viewerCanWrite) throw this.notAllowed(operation, "This GitHub account doesn't have write access to this repository.");
    verifyAccount();
    try {
      await withPrivateTextFile(input.notes, (notesFile) => this.act(target, ['release', 'edit', input.tagName, '-R', target.nameWithOwner, '--title', input.title, '--notes-file', notesFile], operation));
    } finally {
      this.github.invalidate(input.repositoryId);
    }
  }

  async deleteDraft(input: DeleteDraftReleaseInput): Promise<void> {
    const operation = 'gh-release-delete';
    const { target, verifyAccount } = await beginGitHubMutation(this.github, input, operation);
    this.github.invalidate(input.repositoryId);
    const release = await this.viewFor(target, input.tagName, operation);
    if (release.databaseId !== input.expectedDatabaseId) throw this.changed(operation, 'This release changed. Review it and try again.');
    if (!release.isDraft) throw this.notAllowed(operation, 'This release is published, so OpenTig only deletes drafts. Use GitHub to delete it.');
    if (!release.viewerCanWrite) throw this.notAllowed(operation, "This GitHub account doesn't have write access to this repository.");
    verifyAccount();
    try {
      await this.act(target, ['release', 'delete', input.tagName, '-R', target.nameWithOwner, '--yes'], operation);
    } finally {
      this.github.invalidate(input.repositoryId);
    }
  }
}
