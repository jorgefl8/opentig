import type { AiUsage } from '../../shared/ai-log';
import type { AiHarnessId, AiHarnessStatus, AiModelOption } from '../../shared/contracts';

export interface CommitMessageContext {
  repositoryId: string;
  repositoryPath: string;
  branch: string;
  summary: string;
  patch: string;
  stagedPaths: string[];
  /** Null when a split may be offered, otherwise why it may not. */
  splitBlockedReason: string | null;
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

export interface ProviderGenerateResult {
  /** The raw structured output; each caller validates its own schema. */
  output: Record<string, unknown>;
  /** What the harness reported spending, with nulls where it reported nothing. */
  usage: AiUsage;
}

export interface AiProvider {
  readonly id: AiHarnessId;
  status(forceRefresh?: boolean): Promise<AiHarnessStatus>;
  generate(input: ProviderGenerateInput): Promise<ProviderGenerateResult>;
  close?(): Promise<void> | void;
}

export const DEFAULT_MODEL: AiModelOption = { id: 'default', label: 'Default (CLI)' };
