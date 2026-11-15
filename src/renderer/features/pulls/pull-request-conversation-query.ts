import { queryOptions } from '@tanstack/react-query';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

/**
 * A PR's conversation, for its tab and for the viewer, which asks for it as the PR opens.
 * Each comment's Markdown is rendered by its entry, near where it is shown (see `useCommentHtml`).
 */
export function pullRequestConversationQueryOptions(repositoryId: string, number: number) {
  return queryOptions({
    queryKey: queryKeys.pullRequestConversation(repositoryId, number),
    queryFn: () => opentig.github.getPullRequestConversation(repositoryId, number),
    // The PR's live state reloads it as soon as GitHub reports a change.
    staleTime: 60_000,
  });
}
