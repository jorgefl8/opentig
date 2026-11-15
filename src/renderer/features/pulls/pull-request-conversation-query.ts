import { queryOptions } from '@tanstack/react-query';
import type { PullRequestConversationEntry } from '../../../shared/contracts';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';

export type RenderedEntry = PullRequestConversationEntry & { html: string };

async function readConversation(repositoryId: string, number: number) {
  const conversation = await opentig.github.getPullRequestConversation(repositoryId, number);
  const { renderMarkdown } = await import('@/features/markdown/render-markdown');
  const entries = await Promise.all(conversation.entries.map(async (entry): Promise<RenderedEntry> => ({
    ...entry,
    html: entry.body.trim() ? await renderMarkdown(entry.body).catch(() => '<p>Could not render this comment.</p>') : '',
  })));
  return { ...conversation, entries };
}

/** A PR's conversation, for its tab and for the viewer, which asks for it as the PR opens. */
export function pullRequestConversationQueryOptions(repositoryId: string, number: number) {
  return queryOptions({
    queryKey: queryKeys.pullRequestConversation(repositoryId, number),
    queryFn: () => readConversation(repositoryId, number),
    // The PR's live state reloads it as soon as GitHub reports a change.
    staleTime: 60_000,
  });
}
