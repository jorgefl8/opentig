import type { PullRequestDraftContext } from '../types';

export function draftContext(): PullRequestDraftContext {
  return {
    repositoryId: 'repo', repositoryPath: '/sample/repository', branch: 'feature', base: 'main',
    subjects: ['Add feature'], summary: '1 file changed', patch: '+feature', fingerprint: 'same', truncated: false,
    coverage: {
      repositoryId: 'repo', branch: 'feature', base: 'main', headOid: 'a'.repeat(40), baseOid: 'b'.repeat(40), mergeBaseOid: 'b'.repeat(40),
      contextLines: 3, files: [{ path: 'feature.ts', oldPath: null, kind: 'added', additions: 1, deletions: 0, binary: false, detail: 'complete', omittedChangedLines: 0, omittedHunks: 0 }],
      commitsIncluded: 1, commitsTotal: 1, summaryTruncated: false, originalPatchCharacters: 8, suppliedPatchCharacters: 8,
      promptCharacters: 1500, promptCharacterLimit: 448000,
    },
  };
}
