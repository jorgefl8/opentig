import type { CommitFile } from './git-types';

export interface PullRequestContextFile extends CommitFile {
  detail: 'complete' | 'partial' | 'inventory-only';
  omittedChangedLines: number;
  omittedHunks: number;
}

/** Counts describe the input OpenTig supplied, not the quality of the model's answer. */
export interface PullRequestContextCoverage {
  repositoryId: string;
  branch: string;
  base: string;
  headOid: string;
  baseOid: string;
  mergeBaseOid: string;
  contextLines: 1 | 3;
  files: PullRequestContextFile[];
  commitsIncluded: number;
  commitsTotal: number;
  summaryTruncated: boolean;
  originalPatchCharacters: number;
  suppliedPatchCharacters: number;
  promptCharacters: number;
  promptCharacterLimit: number;
}
