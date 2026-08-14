import type { AiHarnessId, AiHarnessStatus, GenerateCommitMessageInput, GeneratedCommitMessage } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import type { GitRepositoryOperations } from '../git/GitRepositoryOperations';
import { buildCommitMessagePrompt, COMMIT_MESSAGE_SCHEMA, parseGeneratedParts } from './CommitMessagePrompt';
import type { AiProvider } from './types';

export class CommitMessageService {
  private readonly providers = new Map<AiHarnessId, AiProvider>();
  private readonly active = new Map<string, { repositoryId: string; controller: AbortController }>();
  private statusCache: { at: number; value: AiHarnessStatus[] } | null = null;

  constructor(private readonly operations: GitRepositoryOperations, providers: AiProvider[]) {
    for (const provider of providers) this.providers.set(provider.id, provider);
  }

  async statuses(forceRefresh = false): Promise<AiHarnessStatus[]> {
    if (!forceRefresh && this.statusCache && Date.now() - this.statusCache.at < 30_000) return this.statusCache.value;
    const value = await Promise.all([...this.providers.values()].map((provider) => provider.status(forceRefresh)));
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  async generate(input: GenerateCommitMessageInput): Promise<GeneratedCommitMessage> {
    if (this.active.has(input.requestId) || [...this.active.values()].some((entry) => entry.repositoryId === input.repositoryId) || this.active.size >= 3) {
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-generate', harness: input.harness, message: 'A generation is already in progress for this repository.' });
    }
    const provider = this.providers.get(input.harness);
    if (!provider) throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'ai-generate', harness: input.harness, message: 'Invalid AI harness.' });
    const status = await provider.status();
    if (!status.installed) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'ai-generate', harness: input.harness, message: `${status.label} is not installed.` });
    if (status.authStatus === 'unauthenticated') throw new AiOperationError({ code: 'AI_AUTH_REQUIRED', operation: 'ai-generate', harness: input.harness, message: `Sign in to ${status.label} to generate the message.` });

    const controller = new AbortController();
    this.active.set(input.requestId, { repositoryId: input.repositoryId, controller });
    try {
      const context = await this.operations.getCommitMessageContext(input.repositoryId);
      const parts = parseGeneratedParts(await provider.generate({ repositoryPath: context.repositoryPath, prompt: buildCommitMessagePrompt(context), schema: COMMIT_MESSAGE_SCHEMA, model: input.model, signal: controller.signal }));
      const current = await this.operations.getCommitMessageContext(input.repositoryId);
      if (current.fingerprint !== context.fingerprint) throw new AiOperationError({ code: 'AI_STAGED_CHANGES_CHANGED', operation: 'ai-generate', harness: input.harness, message: 'Staged changes changed during generation.' });
      return { ...parts, message: parts.body ? `${parts.subject}\n\n${parts.body}` : parts.subject, harness: input.harness, model: input.model, contextWasTruncated: context.truncated };
    } finally {
      this.active.delete(input.requestId);
    }
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
