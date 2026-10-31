import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconChevronDown, IconLoader4 } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { PullRequestLiveState, ReviewPullRequestInput } from '../../../shared/contracts';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MobileMainAction } from '@/components/MobileChrome';
import { MobileSheet } from '@/components/MobileSheet';
import { useMobileChrome } from '@/components/mobile-chrome-context';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { opentig } from '@/lib/opentig-api';
import { ghDetail, ghErrorTitle, isUncertainFailure } from './gh-utils';
import { MarkdownField } from './MarkdownField';
import { useGitHubAccount } from './useGitHubAccount';

type Send = { kind: 'comment' } | { kind: 'review'; verdict: ReviewPullRequestInput['verdict'] };

const SENT: Record<ReviewPullRequestInput['verdict'], string> = { approve: 'Pull request approved', 'request-changes': 'Changes requested', comment: 'Review submitted' };

export function PullRequestComposer({ repositoryId, number, live, draft, onDraftChange, onRefresh }: {
  repositoryId: string;
  number: number;
  live: PullRequestLiveState;
  draft: string;
  onDraftChange(value: string): void;
  onRefresh(): void;
}) {
  const queryClient = useQueryClient();
  const accountQuery = useGitHubAccount(repositoryId);
  const account = accountQuery.data;
  // Sending again after no answer could post the same text twice.
  const [uncertain, setUncertain] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const phone = useMobileChrome() !== null;
  // A draft that survived switching tabs is shown, not folded away. A phone shows it on the docked field instead.
  const [expanded, setExpanded] = useState(!phone && Boolean(draft));
  // Leaving an empty box folds it. Text keeps it open, so it can't go unnoticed.
  useEffect(() => {
    if (phone || !expanded || draft.trim()) return;
    const leave = (event: Event) => {
      if (!(event.target instanceof Element) || root.current?.contains(event.target) || event.target.closest('[data-slot="dropdown-menu-content"]')) return;
      setExpanded(false);
    };
    document.addEventListener('pointerdown', leave);
    document.addEventListener('focusin', leave);
    return () => {
      document.removeEventListener('pointerdown', leave);
      document.removeEventListener('focusin', leave);
    };
  }, [draft, expanded, phone]);
  const send = useMutation({
    mutationFn: (request: Send) => {
      if (account?.state !== 'ready' || !account.login) throw new Error('Check the GitHub account in Settings and try again.');
      const base = { repositoryId, number, body: draft, expectedAccount: { login: account.login, revision: account.revision } };
      return request.kind === 'comment'
        ? opentig.github.commentOnPullRequest(base)
        : opentig.github.reviewPullRequest({ ...base, expectedHeadOid: live.headRefOid, verdict: request.verdict });
    },
    onSuccess: (_result, request) => {
      onDraftChange('');
      setExpanded(false);
      sileo.success({ title: request.kind === 'comment' ? 'Comment posted' : SENT[request.verdict], description: `#${number}` });
    },
    onError: (reason) => {
      const detail = ghDetail(reason);
      if (isUncertainFailure(reason)) {
        setUncertain(true);
        sileo.info({ title: 'No answer from GitHub yet', description: 'It may have been posted. Check the conversation before sending it again.', duration: 10_000 });
      } else {
        sileo.error({ title: ghErrorTitle(detail), description: detail?.message ?? (reason instanceof Error ? reason.message : 'An unexpected error occurred.'), duration: 10_000 });
      }
      if (detail?.code === 'GH_ACCOUNT_UNRESOLVED') void accountQuery.refetch();
    },
    onSettled: () => {
      for (const resource of ['pull-request-conversation', 'pull-request-state', 'pull-request', 'pulls']) void queryClient.invalidateQueries({ queryKey: ['repository', repositoryId, resource] });
    },
  });
  const busy = send.isPending;
  const hasText = Boolean(draft.trim());
  const blocked = busy || uncertain || account?.state !== 'ready';
  const canReview = live.state === 'OPEN';
  // A notice about what may have been posted must stay on screen.
  const collapsed = !expanded && !uncertain;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Menus are portalled but their keys still bubble here, and Escape only closes them.
    if (event.key === 'Escape' && !busy && root.current?.contains(event.target as Node)) setExpanded(false);
  };
  const reviewMenu = canReview && (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant={phone ? 'ghost' : 'outline'} size="xs" disabled={blocked} />}>Review <IconChevronDown /></DropdownMenuTrigger>
      <DropdownMenuContent>
        {!live.viewer.didAuthor && <DropdownMenuItem onClick={() => send.mutate({ kind: 'review', verdict: 'approve' })}>Approve</DropdownMenuItem>}
        {!live.viewer.didAuthor && <DropdownMenuItem disabled={!hasText} onClick={() => send.mutate({ kind: 'review', verdict: 'request-changes' })}>Request changes</DropdownMenuItem>}
        <DropdownMenuItem disabled={!hasText} onClick={() => send.mutate({ kind: 'review', verdict: 'comment' })}>Comment as a review</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const commentButton = (
    <Button size="xs" disabled={blocked || !hasText} onClick={() => send.mutate({ kind: 'comment' })}>
      {busy ? <><IconLoader4 className="animate-spin" /> <ShimmeringText text="Sending…" /></> : 'Comment'}
    </Button>
  );
  const accountNote = uncertain
    ? <span className="pr-composer-account" role="status">It may have been posted. Check the conversation first. <Button variant="ghost" size="xs" onClick={() => { setUncertain(false); onRefresh(); }}>Refresh</Button></span>
    : account?.login && <span className="pr-composer-account">Posting as @{account.login}</span>;
  // This stays mounted while the sheet is closed, so what may have been posted is still known and still blocks a second send.
  if (phone) {
    const firstLine = draft.trim().split('\n', 1)[0];
    return <>
      <MobileMainAction note={uncertain ? 'It may have been posted. Check the conversation first.' : undefined}>
        <button type="button" className={`mobile-main-dock${firstLine ? ' has-text' : ''}`} aria-haspopup="dialog" onClick={() => setExpanded(true)}>{firstLine || 'Write a comment'}</button>
      </MobileMainAction>
      <MobileSheet open={expanded} onOpenChange={(next) => { if (next || !busy) setExpanded(next); }} title="Comment" locked={busy}>
        <div className="pr-composer">
          <MarkdownField id={`pr-comment-${number}`} label="Add a comment" value={draft} rows={4} placeholder="Write a comment (GitHub Markdown)" emptyPreview="_Nothing to preview._" disabled={busy} onChange={onDraftChange} />
          <div className="confirm-sheet-actions">
            {commentButton}
            {reviewMenu}
            {accountNote && <small>{accountNote}</small>}
          </div>
        </div>
      </MobileSheet>
    </>;
  }
  return (
    <div ref={root} className={`pr-composer${collapsed ? ' collapsed' : ''}`} onFocus={() => setExpanded(true)} onClick={() => setExpanded(true)} onKeyDown={onKeyDown}>
      <MarkdownField id={`pr-comment-${number}`} label="Add a comment" value={draft} rows={4} placeholder={collapsed ? 'Write a comment' : 'Write a comment (GitHub Markdown)'} emptyPreview="_Nothing to preview._" disabled={busy} collapsed={collapsed} onChange={(value) => { setExpanded(true); onDraftChange(value); }} />
      {!collapsed && <div className="pr-composer-actions">
        {accountNote}
        {reviewMenu}
        {commentButton}
      </div>}
    </div>
  );
}
