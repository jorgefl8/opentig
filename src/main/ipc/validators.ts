import { GitOperationError } from '../../shared/errors';
import { AiOperationError, GhOperationError } from '../../shared/errors';
import type { AiHarnessId, BranchDetailsRequest, CreatePullRequestInput, DeleteBranchRequest, GenerateCommitMessageInput, GeneratePullRequestDraftInput, PrepareCommitGroupInput, PullRequestState, RemoveWorktreeRequest, WorktreeDetailsRequest } from '../../shared/contracts';
import { MAX_PROJECT_NAME_LENGTH, MAX_REPOSITORY_KEY_LENGTH, normalizeRepositoryKey } from '../../shared/repository-projects';
import { isFilesTreeRepositoryId, MAX_FILES_TREE_PATHS, normalizeExpandedPaths, normalizeFilesTreePath } from '../../shared/files-tree-state';
import { isOpenFilesRepositoryId, MAX_OPEN_FILE_TABS, normalizeOpenFilePath, type OpenFileTab } from '../../shared/open-files-state';
import { SEARCH_MAX_QUERY_LENGTH, SEARCH_MAX_REPLACEMENT_LENGTH, SEARCH_REPLACE_MAX_FILES, type SearchOptions, type SearchReplaceRequest } from '../../shared/search';

export function stringArg(value: unknown, operation: string, maxLength = 32_768): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid argument.' });
  }
  return value;
}

export function searchOptionsArg(value: unknown, operation: string): SearchOptions {
  const input = value as Partial<SearchOptions> | null;
  if (!input || typeof input !== 'object' || typeof input.query !== 'string'
    || input.query.length === 0 || input.query.length > SEARCH_MAX_QUERY_LENGTH || input.query.includes('\0')) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid search.' });
  }
  return {
    query: input.query,
    matchCase: input.matchCase === true,
    wholeWord: input.wholeWord === true,
    regex: input.regex === true,
  };
}

export function pathsArg(value: unknown, operation: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid path selection.' });
  }
  return value;
}

export function textArg(value: unknown, operation: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid content.' });
  }
  return value;
}

export function filesTreeStateArg(repositoryId: unknown, value: unknown, operation: string): { repositoryId: string; expandedPaths: string[] } {
  if (!isFilesTreeRepositoryId(repositoryId) || !Array.isArray(value) || value.length > MAX_FILES_TREE_PATHS) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid Files tree state.' });
  }
  const expandedPaths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const normalized = normalizeFilesTreePath(candidate);
    if (!normalized) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid Files tree state.' });
    if (!seen.has(normalized)) {
      seen.add(normalized);
      expandedPaths.push(normalized);
    }
  }
  return { repositoryId, expandedPaths: normalizeExpandedPaths(expandedPaths) };
}

/**
 * Validates one worktree's open-file tabs. The renderer supplies no timestamp:
 * the store stamps it, so a replayed message cannot outrank a newer record.
 */
export function openFilesStateArg(
  repositoryId: unknown,
  tabs: unknown,
  activePath: unknown,
  previewPath: unknown,
  operation: string,
): { repositoryId: string; tabs: OpenFileTab[]; activePath: string | null; previewPath: string | null } {
  const invalid = () => new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid open files state.' });
  if (!isOpenFilesRepositoryId(repositoryId) || !Array.isArray(tabs) || tabs.length > MAX_OPEN_FILE_TABS) throw invalid();

  const normalizedTabs: OpenFileTab[] = [];
  const seen = new Set<string>();
  for (const candidate of tabs) {
    if (!candidate || typeof candidate !== 'object') throw invalid();
    const input = candidate as Partial<OpenFileTab>;
    const path = normalizeOpenFilePath(input.path);
    if (!path || typeof input.pinned !== 'boolean') throw invalid();
    if (seen.has(path)) continue;
    seen.add(path);
    normalizedTabs.push({ path, pinned: input.pinned });
  }

  const active = optionalOpenFilePath(activePath, invalid);
  const preview = optionalOpenFilePath(previewPath, invalid);
  if (active && !seen.has(active)) throw invalid();
  if (preview && !seen.has(preview)) throw invalid();

  return { repositoryId, tabs: normalizedTabs, activePath: active, previewPath: preview };
}

function optionalOpenFilePath(value: unknown, invalid: () => GitOperationError): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeOpenFilePath(value);
  if (!normalized) throw invalid();
  return normalized;
}

export function projectNameArg(value: unknown, operation: string): string {
  if (typeof value !== 'string') throw invalidProject(operation);
  const name = value.trim();
  if (!name || name.length > MAX_PROJECT_NAME_LENGTH || hasControlCharacters(name)) throw invalidProject(operation);
  return name;
}

export function projectIdArg(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !value || value.length > 64 || hasControlCharacters(value)) throw invalidProject(operation);
  return value;
}

export function nullableProjectIdArg(value: unknown, operation: string): string | null {
  return value === null ? null : projectIdArg(value, operation);
}

export function repositoryKeyArg(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !value || value.length > MAX_REPOSITORY_KEY_LENGTH || hasControlCharacters(value)) throw invalidProject(operation);
  const key = normalizeRepositoryKey(value);
  if (!key) throw invalidProject(operation);
  return key;
}

export function oidArg(value: unknown, operation: string): string {
  const oid = stringArg(value, operation, 64);
  if (!/^[0-9a-f]{40,64}$/i.test(oid)) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid commit.' });
  }
  return oid;
}

const MAX_BRANCH_REF_LENGTH = 512;
const MAX_WORKTREE_PATH_LENGTH = 4_096;

export function branchDetailsArg(value: unknown, operation: string): BranchDetailsRequest {
  const request = requestObject(value, operation);
  return { repositoryId: refsString(request.repositoryId, operation, 64), fullName: refsString(request.fullName, operation, MAX_BRANCH_REF_LENGTH) };
}

export function worktreeDetailsArg(value: unknown, operation: string): WorktreeDetailsRequest {
  const request = requestObject(value, operation);
  return { repositoryId: refsString(request.repositoryId, operation, 64), path: refsString(request.path, operation, MAX_WORKTREE_PATH_LENGTH) };
}

export function deleteBranchArg(value: unknown, operation: string): DeleteBranchRequest {
  const request = requestObject(value, operation);
  return {
    repositoryId: refsString(request.repositoryId, operation, 64),
    fullName: refsString(request.fullName, operation, MAX_BRANCH_REF_LENGTH),
    expectedOid: oidArg(request.expectedOid, operation),
    force: booleanArg(request.force, operation),
  };
}

export function removeWorktreeArg(value: unknown, operation: string): RemoveWorktreeRequest {
  const request = requestObject(value, operation);
  return {
    repositoryId: refsString(request.repositoryId, operation, 64),
    path: refsString(request.path, operation, MAX_WORKTREE_PATH_LENGTH),
    expectedOid: oidArg(request.expectedOid, operation),
    force: booleanArg(request.force, operation),
    deleteBranch: booleanArg(request.deleteBranch, operation),
  };
}

export function searchReplaceArg(value: unknown, operation: string): SearchReplaceRequest {
  const input = value as Partial<SearchReplaceRequest> | null;
  if (!input || typeof input !== 'object' || typeof input.replacement !== 'string'
    || input.replacement.length > SEARCH_MAX_REPLACEMENT_LENGTH || input.replacement.includes('\0')) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid replacement.' });
  }
  const options = searchOptionsArg(input.options, operation);
  const scope = input.scope as SearchReplaceRequest['scope'] | undefined;
  if (!scope || typeof scope !== 'object') throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid replacement scope.' });
  if (scope.kind === 'match') {
    if (!validReplacementTarget(scope) || !Number.isInteger(scope.line) || scope.line < 1 || !Number.isInteger(scope.column) || scope.column < 1) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid replacement match.' });
    }
    return { options, replacement: input.replacement, scope: { kind: 'match', path: scope.path, revision: scope.revision, line: scope.line, column: scope.column } };
  }
  if (scope.kind === 'file') {
    if (!validReplacementTarget(scope)) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid replacement file.' });
    return { options, replacement: input.replacement, scope: { kind: 'file', path: scope.path, revision: scope.revision } };
  }
  if (scope.kind === 'all' && Array.isArray(scope.files) && scope.files.length > 0 && scope.files.length <= SEARCH_REPLACE_MAX_FILES && scope.files.every(validReplacementTarget)) {
    return { options, replacement: input.replacement, scope: { kind: 'all', files: scope.files.map(({ path, revision }) => ({ path, revision })) } };
  }
  throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid replacement scope.' });
}

function validReplacementTarget(value: unknown): value is { path: string; revision: string } {
  const target = value as { path?: unknown; revision?: unknown } | null;
  return Boolean(target && typeof target.path === 'string' && target.path.length > 0 && target.path.length <= 32_768 && !target.path.includes('\0')
    && typeof target.revision === 'string' && /^[0-9a-f]{64}$/.test(target.revision));
}

export function prepareCommitGroupArg(value: unknown, operation: string): PrepareCommitGroupInput {
  const input = requestObject(value, operation);
  const paths = pathsArg(input.paths, operation);
  if (paths.length === 0) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Select at least one file.' });
  const expectedStagedPaths = Array.isArray(input.expectedStagedPaths) && input.expectedStagedPaths.length === 0
    ? []
    : pathsArg(input.expectedStagedPaths, operation);
  // Every group of a plan carries its own fingerprint, so this is now mandatory:
  // an omitted one used to mean "no staleness check at all".
  const expectedFingerprint = stringArg(input.expectedFingerprint, operation, 64);
  if (!/^[0-9a-f]{64}$/i.test(expectedFingerprint)) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid commit group snapshot.' });
  }
  return { repositoryId: stringArg(input.repositoryId, operation, 64), paths, expectedStagedPaths, expectedFingerprint };
}

/**
 * Destructive refs requests arrive as one typed object rather than several
 * unchecked positional strings. Arrays are rejected so an array's numeric keys
 * can never stand in for named fields.
 */
function requestObject(value: unknown, operation: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid request.' });
  }
  return value as Record<string, unknown>;
}

function refsString(value: unknown, operation: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || hasControlCharacters(value)) {
    throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid request.' });
  }
  return value;
}

export function generateCommitMessageArg(value: unknown): GenerateCommitMessageInput {
  const operation = 'ai-generate-commit-message';
  if (!value || typeof value !== 'object') throw invalidAi(operation);
  const input = value as Partial<GenerateCommitMessageInput>;
  const harness = input.harness;
  if (harness !== 'codex' && harness !== 'claude' && harness !== 'opencode') throw invalidAi(operation);
  return {
    repositoryId: aiString(input.repositoryId, operation, 64),
    harness: harness as AiHarnessId,
    model: aiString(input.model, operation, 200, true),
    requestId: aiString(input.requestId, operation, 100, true),
  };
}

export function prNumberArg(value: unknown, operation: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000) {
    throw new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Invalid pull request number.' });
  }
  return value;
}

export function pullRequestStatesArg(value: unknown, operation: string): PullRequestState[] {
  if (!Array.isArray(value) || value.length > 3 || new Set(value).size !== value.length) throw invalidGh(operation);
  const allowed: PullRequestState[] = ['OPEN', 'CLOSED', 'MERGED'];
  if (!value.every((state) => typeof state === 'string' && allowed.includes(state as PullRequestState))) throw invalidGh(operation);
  return allowed.filter((state) => value.includes(state));
}

export function createPullRequestArg(value: unknown): CreatePullRequestInput {
  const operation = 'gh-pr-create';
  if (!value || typeof value !== 'object') throw invalidGh(operation);
  const input = value as Partial<CreatePullRequestInput>;
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300 || input.title.includes('\0')) throw invalidGh(operation);
  if (typeof input.body !== 'string' || input.body.length > 100 * 1024 || input.body.includes('\0')) throw invalidGh(operation);
  if (typeof input.base !== 'string' || !input.base || input.base.length > 300 || input.base.includes('\0')) throw invalidGh(operation);
  if (typeof input.draft !== 'boolean') throw invalidGh(operation);
  if (typeof input.repositoryId !== 'string' || !input.repositoryId || input.repositoryId.length > 64) throw invalidGh(operation);
  return { repositoryId: input.repositoryId, title: input.title.trim(), body: input.body, base: input.base, draft: input.draft };
}

export function generatePullRequestDraftArg(value: unknown): GeneratePullRequestDraftInput {
  const operation = 'ai-pr-draft';
  if (!value || typeof value !== 'object') throw invalidAi(operation);
  const input = value as Partial<GeneratePullRequestDraftInput>;
  const harness = input.harness;
  if (harness !== 'codex' && harness !== 'claude' && harness !== 'opencode') throw invalidAi(operation);
  return {
    repositoryId: aiString(input.repositoryId, operation, 64),
    base: aiString(input.base, operation, 300, true),
    harness: harness as AiHarnessId,
    model: aiString(input.model, operation, 200, true),
    requestId: aiString(input.requestId, operation, 100, true),
  };
}

function invalidGh(operation: string): GhOperationError {
  return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Invalid pull request data.' });
}

export function booleanArg(value: unknown, operation: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw invalidAi(operation);
  return value;
}

export function aiString(value: unknown, operation: string, maxLength: number, rejectControls = false): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0') || (rejectControls && hasControlCharacters(value))) {
    throw invalidAi(operation);
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function invalidAi(operation: string): AiOperationError {
  return new AiOperationError({ code: 'AI_PROCESS_FAILED', operation, message: 'Invalid AI configuration.' });
}

function invalidProject(operation: string): GitOperationError {
  return new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'Invalid project data.' });
}
