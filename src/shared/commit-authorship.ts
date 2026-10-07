import { z } from 'zod';

export interface CommitIdentity {
  name: string;
  email: string;
}

export interface CommitAuthorship {
  author: CommitIdentity | null;
  committer: CommitIdentity | null;
  source: 'local' | 'global' | 'system' | 'worktree' | 'environment' | 'custom' | 'mixed' | 'inferred' | 'unset';
  editable: boolean;
  blockers: string[];
  /** Opaque optimistic concurrency token; never contains configuration values. */
  revision: string;
}

export const commitAuthorshipInputSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[^<>]+$/).refine(noControls),
  email: z.string().trim().max(254).regex(/^[^\s<>@]+@[^\s<>@]+$/).refine(noControls),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SetCommitAuthorshipInput = z.infer<typeof commitAuthorshipInputSchema>;

function noControls(value: string): boolean {
  return [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}
