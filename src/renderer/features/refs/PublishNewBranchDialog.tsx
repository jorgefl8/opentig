import { IconLoader4 } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import type { NewBranchChoice } from './useBranchPush';

/**
 * Confirms publishing a branch under its own name when it tracks a branch with
 * another name, such as one created from `origin/dev`. There is deliberately no
 * way to push to that upstream from here.
 */
export function PublishNewBranchDialog({ choice, onConfirm }: { choice: NewBranchChoice; onConfirm(confirmed: boolean): void }) {
  const upstream = `${choice.upstream.remote}/${choice.upstream.branch}`;
  const destination = `${choice.remote}/${choice.branch}`;
  const { ahead } = choice.upstream;
  const commits = ahead === null ? null : `${ahead} ${ahead === 1 ? 'commit' : 'commits'}`;
  return <Dialog open onOpenChange={open => { if (!open) onConfirm(false); }}>
    <DialogPopup className="undo-commit-dialog">
      <div className="undo-commit-content">
        <DialogTitle>Publish as a new branch?</DialogTitle>
        <DialogDescription>
          This branch tracks <code>{upstream}</code>. Pushing there would add {ahead === 1 || ahead === null ? 'your commit' : 'your commits'} directly
          to <code>{choice.upstream.branch}</code>, so OpenTig publishes it under its own name instead.
        </DialogDescription>
        <dl className="publish-new-branch-summary">
          <dt>Commit</dt><dd>{commits && <>{commits} · </>}<code>{choice.oid.slice(0, 7)}</code></dd>
          <dt>Destination</dt><dd><code>{destination}</code></dd>
          <dt>Upstream</dt><dd><code><s>{upstream}</s></code> → <code>{destination}</code></dd>
        </dl>
        <details className="settings-disclosure publish-new-branch-command">
          <summary>Equivalent Git command</summary>
          <code>git push -u {choice.remote} HEAD:refs/heads/{choice.branch}</code>
        </details>
      </div>
      <div className="undo-commit-actions">
        <Button variant="ghost" disabled={choice.publishing} onClick={() => onConfirm(false)}>Cancel</Button>
        <Button disabled={choice.publishing} onClick={() => onConfirm(true)}>
          {choice.publishing ? <><IconLoader4 className="animate-spin" />Publishing…</> : 'Publish branch'}
        </Button>
      </div>
    </DialogPopup>
  </Dialog>;
}
