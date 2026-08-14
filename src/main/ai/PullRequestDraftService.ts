import type { AiHarnessId, GeneratePullRequestDraftInput, GeneratedPullRequestDraft } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import { buildPullRequestPrompt, parsePullRequestDraft, PR_DRAFT_SCHEMA } from './PullRequestPrompt';
import type { AiProvider } from './types';

export class PullRequestDraftService {
  private readonly providers = new Map<AiHarnessId, AiProvider>();
  private readonly active = new Map<string, { repositoryId: string; controller: AbortController }>();

  constructor(private readonly operations: GitRepositoryOperations, providers: AiProvider[]) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  async generate(input: GeneratePullRequestDraftInput): Promise<GeneratedPullRequestDraft> {
    if (this.active.has(input.requestId) || [...this.active.values()].some((entry) => entry.repositoryId === input.repositoryId) || this.active.size >= 3) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-draft', harness: input.harness, message: 'A generation is already in progress for this repository.' });
    }
    const provider = this.providers.get(input.harness);
    if (!provider) throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-pr-draft', harness: input.harness, message: 'Invalid AI harness.' });
    const status = await provider.status();
    if (!status.installed) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'ai-pr-draft', harness: input.harness, message: `${status.label} is not installed.` });
    if (status.authStatus === 'unauthenticated') throw new AiOperationError({ code: 'AI_AUTH_REQUIRED', operation: 'ai-pr-draft', harness: input.harness, message: `Sign in to ${status.label} to generate the draft.` });

    const controller = new AbortController();
    this.active.set(input.requestId, { repositoryId: input.repositoryId, controller });
    try {
      const context = await this.operations.getPullRequestDraftContext(input.repositoryId, input.base);
      const parts = parsePullRequestDraft(await provider.generate({ repositoryPath: context.repositoryPath, prompt: buildPullRequestPrompt(context), schema: PR_DRAFT_SCHEMA, model: input.model, signal: controller.signal }));
      const current = await this.operations.getPullRequestDraftContext(input.repositoryId, input.base);
      if (current.fingerprint !== context.fingerprint) {
        throw new AiOperationError({ code: 'AI_STAGED_CHANGES_CHANGED', operation: 'ai-pr-draft', harness: input.harness, message: 'The branch changed during generation.' });
      }
      return { ...parts, harness: input.harness, model: input.model, contextWasTruncated: context.truncated };
    } finally {
      this.active.delete(input.requestId);
    }
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.controller.abort();
  }

  close(): void {
    for (const entry of this.active.values()) entry.controller.abort();
    this.active.clear();
  }
}
