import { useCallback, useState } from 'react';

/**
 * What a viewer must not forget when it unmounts: text being typed, so opening another pull request
 * doesn't throw it away, and an action with no answer, so it isn't offered again by accident.
 */
const drafts = new Map<string, unknown>();

export const pullRequestEditDraft = (repositoryId: string, number: number) => `${repositoryId}:pull-request:${number}:edit`;
export const pullRequestCommentDraft = (repositoryId: string, number: number) => `${repositoryId}:pull-request:${number}:comment`;
export const pullRequestCommentUncertain = (repositoryId: string, number: number) => `${repositoryId}:pull-request:${number}:comment-uncertain`;
export const pullRequestRevertUncertain = (repositoryId: string, number: number) => `${repositoryId}:pull-request:${number}:revert-uncertain`;
export const releaseEditDraft = (repositoryId: string, tagName: string) => `${repositoryId}:release:${tagName}:edit`;

export const hasViewerDraft = (key: string) => drafts.has(key);
export const forgetViewerDrafts = () => drafts.clear();

export function useViewerDraft<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? drafts.get(key) as T : initial()));
  const update = useCallback((next: T) => { drafts.set(key, next); setValue(next); }, [key]);
  const discard = useCallback(() => { drafts.delete(key); }, [key]);
  return [value, update, discard] as const;
}
