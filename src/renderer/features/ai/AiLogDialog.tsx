import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconLoader4, IconRefresh, IconTrash, IconX } from '@tabler/icons-react';
import { toast } from 'sonner';
import type { AiLogEntry } from '@shared/ai-log';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';

interface AiLogDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * Local history of AI runs. Reads the diagnostic log written by the main
 * process; it holds metadata only, never a prompt or any file content.
 */
export function AiLogDialog({ open, onOpenChange }: AiLogDialogProps) {
  const [entries, setEntries] = useState<AiLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await window.justgit.ai.log()); }
    catch (reason) { toast.error('Could not read the AI history', { description: messageOf(reason) }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) void load(); }, [load, open]);

  const totals = useMemo(() => {
    const failed = entries.filter((entry) => entry.status === 'failed').length;
    return {
      runs: entries.length,
      failed,
      // Only runs whose harness actually reported a figure are summed, so a
      // harness that reports nothing cannot look free.
      tokens: entries.reduce((total, entry) => total + (entry.usage.inputTokens ?? 0) + (entry.usage.outputTokens ?? 0), 0),
      cost: entries.reduce((total, entry) => total + (entry.usage.costUsd ?? 0), 0),
      costed: entries.filter((entry) => entry.usage.costUsd !== null).length,
    };
  }, [entries]);

  const clear = async () => {
    if (!window.confirm('Delete the whole AI history? This cannot be undone.')) return;
    try {
      await window.justgit.ai.clearLog();
      setEntries([]);
    } catch (reason) {
      toast.error('Could not clear the AI history', { description: messageOf(reason) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="ai-log-dialog">
        <header className="ai-log-header">
          <div>
            <DialogTitle>AI history</DialogTitle>
            <DialogDescription>Recent generations on this machine. Prompts and file contents are never recorded.</DialogDescription>
          </div>
          <div className="ai-log-header-actions">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
              {loading ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} Refresh
            </Button>
            <Button variant="ghost" size="sm" disabled={entries.length === 0} onClick={() => void clear()}><IconTrash /> Clear</Button>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close AI history" />}><IconX /></DialogClose>
          </div>
        </header>

        {entries.length > 0 && (
          <div className="ai-log-totals">
            <span><strong>{totals.runs}</strong> runs</span>
            <span><strong>{totals.failed}</strong> failed</span>
            <span><strong>{formatCount(totals.tokens)}</strong> tokens</span>
            {totals.costed > 0 && <span><strong>${totals.cost.toFixed(4)}</strong> reported by {totals.costed} of {totals.runs}</span>}
          </div>
        )}

        <div className="ai-log-body">
          {loading && entries.length === 0 && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Reading history…" /></div>}
          {!loading && entries.length === 0 && <p className="ai-log-empty">No generations recorded yet. Generate a commit message and it will show up here.</p>}
          {entries.map((entry) => (
            <article key={entry.id} className={`ai-log-row ${entry.status}`}>
              <div className="ai-log-row-main">
                <span className="ai-log-row-title">
                  <Badge variant={entry.status === 'success' ? 'secondary' : entry.status === 'cancelled' ? 'outline' : 'destructive'}>{entry.status}</Badge>
                  <strong>{entry.harness}</strong>
                  <small>{entry.model}</small>
                  <small>{entry.operation === 'commit-message' ? 'commit message' : 'pull request draft'}</small>
                </span>
                <span className="ai-log-row-meta">
                  <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                  <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
                  <span>{describeUsage(entry)}</span>
                  {entry.stagedFileCount !== null && <span>{entry.stagedFileCount} staged</span>}
                  {entry.contextTruncated === true && <span>context trimmed</span>}
                </span>
              </div>
              <div className="ai-log-row-notes">
                {entry.errorCode && <span className="ai-log-note error">{entry.errorCode}</span>}
                {entry.splitOffered === true && <span className="ai-log-note">split: {entry.splitGroups} commits</span>}
                {/* The reason a plan was thrown away is the point of this log. */}
                {entry.splitRejectedReason && <span className="ai-log-note warn">split refused: {entry.splitRejectedReason}</span>}
                {entry.splitBlockedReason && <span className="ai-log-note">no split: {entry.splitBlockedReason}</span>}
              </div>
            </article>
          ))}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function describeUsage(entry: AiLogEntry): string {
  const { inputTokens, outputTokens, costUsd } = entry.usage;
  if (inputTokens === null && outputTokens === null) return 'no usage reported';
  const tokens = `${formatCount(inputTokens ?? 0)} in · ${formatCount(outputTokens ?? 0)} out`;
  return costUsd === null ? tokens : `${tokens} · $${costUsd.toFixed(4)}`;
}

function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'An unexpected error occurred.';
}
