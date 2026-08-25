import { EMPTY_AI_USAGE, type AiUsage } from '../../shared/ai-log';
import type { AiHarnessId, AiHarnessStatus, CommitSplitProposal, GenerateCommitMessageInput, GeneratedCommitMessage } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import { type AiLogRecorder, failureLogFields, recordSafely } from '../persistence/AiLogStore';
import { buildCommitMessagePrompt, COMMIT_MESSAGE_SCHEMA, type ParsedCommitPlan, parseCommitSplitProposal, parseGeneratedParts } from './CommitMessagePrompt';
import type { AiProvider } from './types';

export class CommitMessageService {
  private readonly providers = new Map<AiHarnessId, AiProvider>();
  private readonly active = new Map<string, { repositoryId: string; controller: AbortController }>();
  private statusCache: { at: number; value: AiHarnessStatus[] } | null = null;

  constructor(
    private readonly operations: GitRepositoryOperations,
    providers: AiProvider[],
    private readonly log?: AiLogRecorder,
  ) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  async statuses(forceRefresh = false): Promise<AiHarnessStatus[]> {
    if (!forceRefresh && this.statusCache && Date.now() - this.statusCache.at < 30_000) return this.statusCache.value;
    const value = await Promise.all([...this.providers.values()].map((provider) => provider.status(forceRefresh)));
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  async generate(input: GenerateCommitMessageInput, externalSignal?: AbortSignal): Promise<GeneratedCommitMessage> {
    if (this.active.has(input.requestId) || [...this.active.values()].some((entry) => entry.repositoryId === input.repositoryId) || this.active.size >= 3) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-generate', harness: input.harness, message: 'A generation is already in progress for this repository.' });
    }
    const provider = this.providers.get(input.harness);
    if (!provider) throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-generate', harness: input.harness, message: 'Invalid AI harness.' });
    const status = await provider.status();
    if (!status.installed) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'ai-generate', harness: input.harness, message: `${status.label} is not installed.` });
    if (status.authStatus === 'unauthenticated') throw new AiOperationError({ code: 'AI_AUTH_REQUIRED', operation: 'ai-generate', harness: input.harness, message: `Sign in to ${status.label} to generate the message.` });
    throwIfCancelled(externalSignal, input.harness);

    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    this.active.set(input.requestId, { repositoryId: input.repositoryId, controller });
    const startedAt = Date.now();
    let usage: AiUsage = { ...EMPTY_AI_USAGE };
    let stagedFileCount: number | null = null;
    let contextTruncated: boolean | null = null;
    try {
      const context = await this.operations.getCommitMessageContext(input.repositoryId);
      stagedFileCount = context.stagedPaths.length;
      contextTruncated = context.truncated;
      throwIfCancelled(signal, input.harness);
      const generated = await provider.generate({ repositoryPath: context.repositoryPath, prompt: buildCommitMessagePrompt(context), schema: COMMIT_MESSAGE_SCHEMA, model: input.model, signal });
      usage = generated.usage;
      const parts = parseGeneratedParts(generated.output);
      const current = await this.operations.getCommitMessageContext(input.repositoryId);
      throwIfCancelled(signal, input.harness);
      if (current.fingerprint !== context.fingerprint) throw new AiOperationError({ code: 'AI_STAGED_CHANGES_CHANGED', operation: 'ai-generate', harness: input.harness, message: 'Staged changes changed during generation.' });
      // A truncated patch no longer blocks the split: grouping needs the file
      // list, which `splitBlockedReason` already guarantees is complete.
      const parsed = context.splitBlockedReason ? null : parseCommitSplitProposal(generated.output, context.stagedPaths);
      const proposal = parsed?.status === 'accepted' ? await this.withGroupFingerprints(input.repositoryId, parsed.plan) : null;
      recordSafely(this.log, {
        operation: 'commit-message', harness: input.harness, model: input.model, repositoryId: input.repositoryId,
        status: 'success', durationMs: Date.now() - startedAt, errorCode: null, errorMessage: null, usage,
        stagedFileCount, contextTruncated,
        splitOffered: proposal !== null,
        splitGroups: proposal ? proposal.commits.length : null,
        // The one field that makes the prompt tunable: a plan the model did
        // offer and OpenTig refused, and exactly why.
        splitRejectedReason: parsed?.status === 'rejected' ? parsed.reason : null,
        splitBlockedReason: context.splitBlockedReason,
      });
      return {
        ...parts,
        message: parts.body ? `${parts.subject}\n\n${parts.body}` : parts.subject,
        harness: input.harness,
        model: input.model,
        contextWasTruncated: context.truncated,
        proposal,
        splitBlockedReason: context.splitBlockedReason,
      };
    } catch (error) {
      const failure = failureLogFields(error);
      recordSafely(this.log, {
        operation: 'commit-message', harness: input.harness, model: input.model, repositoryId: input.repositoryId,
        // A cancellation is a decision, not a failure; merging the two would
        // poison any reliability figure taken from this log.
        status: failure.status, durationMs: Date.now() - startedAt,
        errorCode: failure.errorCode, errorMessage: failure.errorMessage, usage,
        stagedFileCount, contextTruncated,
        splitOffered: null, splitGroups: null, splitRejectedReason: null, splitBlockedReason: null,
      });
      throw error;
    } finally {
      this.active.delete(input.requestId);
    }
  }

  /**
   * Gives every group its own content fingerprint so each commit of the plan
   * keeps a staleness check of its own, instead of only the first one.
   */
  private async withGroupFingerprints(repositoryId: string, plan: ParsedCommitPlan): Promise<CommitSplitProposal> {
    const commits = await Promise.all(plan.commits.map(async (commit) => ({
      ...commit,
      fingerprint: await this.operations.commitGroupFingerprint(repositoryId, commit.paths),
    })));
    return { rationale: plan.rationale, commits };
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.controller.abort();
  }

  async close(): Promise<void> {
    for (const entry of this.active.values()) entry.controller.abort();
    await Promise.all([...this.providers.values()].map(async (provider) => provider.close?.()));
    this.active.clear();
  }
}

function throwIfCancelled(signal: AbortSignal | undefined, harness: AiHarnessId): void {
  if (!signal?.aborted) return;
  throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'ai-generate', harness, message: 'Generation canceled.' });
}
