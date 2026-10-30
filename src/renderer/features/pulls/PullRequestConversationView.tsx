import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconExternalLink, IconLoader4, IconMessage, IconRefresh } from '@tabler/icons-react';
import { formatDateTime } from '@shared/date-format';
import type { PullRequestConversationEntry } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { LinkedMarkdown } from '@/features/markdown/LinkedMarkdown';
import { opentig } from '@/lib/opentig-api';
import { queryKeys } from '@/lib/query-client';
import { openOnGitHub } from './gh-utils';
import { GitHubAvatar } from './GitHubAvatar';

type RenderedEntry = PullRequestConversationEntry & { html: string };

const VERDICT_TEXT: Record<NonNullable<PullRequestConversationEntry['verdict']>, { text: string; className?: string }> = {
  APPROVED: { text: 'approved', className: 'verdict-approved' },
  CHANGES_REQUESTED: { text: 'requested changes', className: 'verdict-changes' },
  COMMENTED: { text: 'reviewed' },
  DISMISSED: { text: 'gave a dismissed review' },
  PENDING: { text: 'is reviewing' },
};

async function readConversation(repositoryId: string, number: number) {
  const conversation = await opentig.github.getPullRequestConversation(repositoryId, number);
  const { renderMarkdown } = await import('@/features/markdown/render-markdown');
  const entries = await Promise.all(conversation.entries.map(async (entry): Promise<RenderedEntry> => ({
    ...entry,
    html: entry.body.trim() ? await renderMarkdown(entry.body).catch(() => '<p>Could not render this comment.</p>') : '',
  })));
  return { ...conversation, entries };
}

/** Comments and reviews come from third parties: they only reach the page through the sanitizing Markdown pipeline. */
export function PullRequestConversationView({ repositoryId, number, url }: { repositoryId: string; number: number; url: string }) {
  const [hideBots, setHideBots] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.pullRequestConversation(repositoryId, number),
    queryFn: () => readConversation(repositoryId, number),
  });
  const conversation = query.data;
  const entries = conversation?.entries ?? [];
  const shown = hideBots ? entries.filter((entry) => !entry.author?.isBot) : entries;
  const hasBots = entries.some((entry) => entry.author?.isBot);
  return (
    <section className="pr-conversation" aria-label="Conversation">
      <div className="pr-conversation-head">
        <h3><IconMessage aria-hidden="true" /> Conversation {conversation && <span>{shown.length}{conversation.truncated ? '+' : ''}</span>}</h3>
        {hasBots && <label className="pr-conversation-filter"><Checkbox checked={hideBots} onCheckedChange={(checked) => setHideBots(checked === true)} /> Hide bots</label>}
      </div>
      {query.isPending && <p className="pr-empty-description" role="status"><IconLoader4 className="animate-spin" aria-hidden="true" /> <ShimmeringText text="Loading conversation…" /></p>}
      {query.isError && (
        <div className="pr-live-notice" role="status">
          {conversation ? "Couldn't refresh. Showing the last conversation." : "Couldn't load the conversation."}
          <Button variant="ghost" size="xs" disabled={query.isFetching} onClick={() => void query.refetch()}><IconRefresh /> Retry</Button>
        </div>
      )}
      {conversation && !shown.length && <p className="pr-empty-description">{entries.length ? 'Only bots have commented.' : 'Nobody has commented yet.'}</p>}
      {shown.map((entry) => <ConversationEntry key={entry.id} entry={entry} />)}
      {conversation?.partial && <p className="pr-empty-description">GitHub didn't share every detail with this account, so some of the conversation may be missing.</p>}
      {conversation?.truncated && <p className="pr-empty-description">Showing the most recent comments and reviews. {url && <button className="pr-checks-all" onClick={() => openOnGitHub(url)}>Read the rest on GitHub <IconExternalLink aria-hidden="true" /></button>}</p>}
    </section>
  );
}

function ConversationEntry({ entry }: { entry: RenderedEntry }) {
  const verdict = entry.verdict ? VERDICT_TEXT[entry.verdict] : null;
  const body = entry.html ? <LinkedMarkdown html={entry.html} /> : null;
  return (
    <article className="pr-conversation-entry">
      <GitHubAvatar key={entry.author?.avatarUrl} src={entry.author?.avatarUrl ?? null} className="pr-conversation-avatar" />
      <div className="pr-conversation-meta">
        <strong>{entry.author?.login ?? 'Deleted account'}</strong>
        {entry.author?.isBot && <span className="pr-conversation-bot">bot</span>}
        {verdict ? <span className={verdict.className}>{verdict.text}</span> : <span>commented</span>}
        {entry.createdAt && <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>}
        {entry.url && <Button variant="ghost" size="icon-xs" className="pr-conversation-link" aria-label="Open on GitHub" onClick={() => openOnGitHub(entry.url!)}><IconExternalLink /></Button>}
      </div>
      {body && <div className="pr-conversation-body">
        {entry.minimized ? <details className="pr-conversation-hidden"><summary>Hidden on GitHub. Show anyway</summary>{body}</details> : body}
      </div>}
      {entry.verdict === 'COMMENTED' && !body && <div className="pr-conversation-body"><small className="pr-action-note">Left comments on the code. Read them on GitHub.</small></div>}
    </article>
  );
}
