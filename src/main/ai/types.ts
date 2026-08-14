import type { AiHarnessId, AiHarnessStatus, AiModelOption } from '../../shared/contracts';

export interface CommitMessageContext {
  repositoryId: string;
  repositoryPath: string;
  branch: string;
  summary: string;
  patch: string;
  recentSubjects: string[];
  fingerprint: string;
  truncated: boolean;
}

export interface GeneratedParts {
  subject: string;
  body: string;
}

export interface PullRequestDraftContext {
  repositoryId: string;
  repositoryPath: string;
  branch: string;
  base: string;
  subjects: string[];
  summary: string;
  patch: string;
  fingerprint: string;
  truncated: boolean;
}

export interface ProviderGenerateInput {
  repositoryPath: string;
  prompt: string;
  schema: Record<string, unknown>;
  model: string;
  signal: AbortSignal;
}

export interface AiProvider {
  readonly id: AiHarnessId;
  status(forceRefresh?: boolean): Promise<AiHarnessStatus>;
  /** Returns the raw structured output; each caller validates its own schema. */
  generate(input: ProviderGenerateInput): Promise<Record<string, unknown>>;
  close?(): Promise<void> | void;
}

export const DEFAULT_MODEL: AiModelOption = { id: 'default', label: 'Default (CLI)' };
