import type { SerializedOperationError } from './errors';

/** What became of the read a kept answer was served ahead of. */
export type KeptRefreshOutcome =
  | { outcome: 'updated' }
  | { outcome: 'failed'; error: SerializedOperationError };

/**
 * An answer served from what the server kept, older than it would serve as
 * current, while it reads it again. `readAt` is when GitHub gave it.
 */
export interface KeptAnswer {
  readAt: string;
  refresh: Promise<KeptRefreshOutcome>;
}

/** Where a read hands a kept answer, for a client that can show one marked as old. Absent for one that can't. */
export type KeptAnswerSink = (answer: KeptAnswer) => void;
