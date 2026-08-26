import { EMPTY_AI_USAGE, type AiUsage } from '../../shared/ai-log';
import type { AiHarnessId, GeneratePullRequestDraftInput, GeneratedPullRequestDraft } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import { type AiLogRecorder, failureLogFields, recordSafely } from '../persistence/AiLogStore';
import { buildPullRequestPrompt, parsePullRequestDraft, PR_DRAFT_SCHEMA } from './PullRequestPrompt';
import type { AiProvider } from './types';

export class PullRequestDraftService {
  private readonly providers = new Map<AiHarnessId, AiProvider>();
  private readonly active = new Map<string, { repositoryId: string; controller: AbortController }>();

  constructor(
    private readonly operations: GitRepositoryOperations,
    providers: AiProvider[],
    private readonly log?: AiLogRecorder,
  ) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  async generate(input: GeneratePullRequestDraftInput, externalSignal?: AbortSignal): Promise<GeneratedPullRequestDraft> {
    if (this.active.has(input.requestId) || [...this.active.values()].some((entry) => entry.repositoryId === input.repositoryId) || this.active.size >= 3) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-draft', harness: input.harness, message: 'A generation is already in progress for this repository.' });
    }
    const provider = this.providers.get(input.harness);
    if (!provider) throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-draft', harness: input.harness, message: 'Invalid AI harness.' });
    const status = await provider.status();
    if (!status.installed) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'ai-pr-draft', harness: input.harness, message: `${status.label} is not installed.` });
    if (status.authStatus === 'unauthenticated') throw new AiOperationError({ code: 'AI_AUTH_REQUIRED', operation: 'ai-pr-draft', harness: input.harness, message: `Sign in to ${status.label} to generate the draft.` });
    throwIfCancelled(externalSignal, input.harness);

    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    this.active.set(input.requestId, { repositoryId: input.repositoryId, controller });
    const startedAt = Date.now();
    let usage: AiUsage = { ...EMPTY_AI_USAGE };
    let contextTruncated: boolean | null = null;
    try {
      const context = await this.operations.getPullRequestDraftContext(input.repositoryId, input.base);
      contextTruncated = context.truncated;
      throwIfCancelled(signal, input.harness);
      const generated = await provider.generate({ repositoryPath: context.repositoryPath, prompt: buildPullRequestPrompt(context), schema: PR_DRAFT_SCHEMA, model: input.model, signal });
      usage = generated.usage;
      const parts = parsePullRequestDraft(generated.output);
      const current = await this.operations.getPullRequestDraftContext(input.repositoryId, input.base);
      throwIfCancelled(signal, input.harness);
      if (current.fingerprint !== context.fingerprint) {
        throw new AiOperationError({ code: 'AI_STAGED_CHANGES_CHANGED', operation: 'ai-pr-draft', harness: input.harness, message: 'The branch changed during generation.' });
      }
      this.record(input, 'success', null, null, usage, contextTruncated, Date.now() - startedAt);
      return { ...parts, harness: input.harness, model: input.model, contextWasTruncated: context.truncated };
    } catch (error) {
      const failure = failureLogFields(error);
      this.record(input, failure.status, failure.errorCode, failure.errorMessage, usage, contextTruncated, Date.now() - startedAt);
      throw error;
    } finally {
      this.active.delete(input.requestId);
    }
  }

  private record(
    input: GeneratePullRequestDraftInput,
    status: 'success' | 'failed' | 'cancelled',
    errorCode: string | null,
    errorMessage: string | null,
    usage: AiUsage,
    contextTruncated: boolean | null,
    durationMs: number,
  ): void {
    recordSafely(this.log, {
      operation: 'pull-request-draft', harness: input.harness, model: input.model, repositoryId: input.repositoryId,
      status, durationMs, errorCode, errorMessage, usage,
      // Split fields belong to commit messages; a draft has no equivalent.
      stagedFileCount: null, contextTruncated,
      splitOffered: null, splitGroups: null, splitRejectedReason: null, splitBlockedReason: null,
    });
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.controller.abort();
  }

  close(): void {
    for (const entry of this.active.values()) entry.controller.abort();
    this.active.clear();
  }
}

function throwIfCancelled(signal: AbortSignal | undefined, harness: AiHarnessId): void {
  if (!signal?.aborted) return;
  throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'ai-pr-draft', harness, message: 'Generation canceled.' });
}
