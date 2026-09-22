import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from '@tanstack/react-table';
import { IconArrowsSort, IconLoader4, IconRefresh, IconSortAscending, IconSortDescending, IconTrash, IconX } from '@tabler/icons-react';
import { sileo } from 'sileo';
import type { AiLogEntry } from '@shared/ai-log';
import { opentig } from '@/lib/opentig-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface AiLogDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

const OPERATION_LABEL: Record<AiLogEntry['operation'], string> = {
  'commit-message': 'commit message',
  'pull-request-draft': 'pull request draft',
};

interface SortableColumn {
  getIsSorted(): false | 'asc' | 'desc';
  toggleSorting(desc?: boolean): void;
}

function SortableHeader<TColumn extends SortableColumn>({ column, label }: { column: TColumn; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <button type="button" className="ai-log-sort-button" onClick={() => column.toggleSorting(sorted === 'asc')}>
      {label}
      {sorted === 'asc' && <IconSortAscending size={13} />}
      {sorted === 'desc' && <IconSortDescending size={13} />}
      {!sorted && <IconArrowsSort size={13} className="ai-log-sort-idle" />}
    </button>
  );
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

const columnHelper = createColumnHelper<typeof features, AiLogEntry>();

const columns = columnHelper.columns([
  columnHelper.accessor('status', {
    header: ({ column }) => <SortableHeader column={column} label="Status" />,
    cell: ({ getValue }) => {
      const status = getValue();
      return <Badge variant={status === 'success' ? 'secondary' : status === 'cancelled' ? 'outline' : 'destructive'}>{status}</Badge>;
    },
  }),
  columnHelper.accessor('harness', {
    header: ({ column }) => <SortableHeader column={column} label="Harness" />,
    cell: ({ getValue }) => <strong>{getValue()}</strong>,
  }),
  columnHelper.accessor('model', {
    header: ({ column }) => <SortableHeader column={column} label="Model" />,
    cell: ({ getValue }) => <span className="ai-log-model">{getValue()}</span>,
  }),
  columnHelper.accessor('operation', {
    header: ({ column }) => <SortableHeader column={column} label="Task" />,
    cell: ({ getValue }) => OPERATION_LABEL[getValue()],
  }),
  columnHelper.accessor((entry) => new Date(entry.at).getTime(), {
    id: 'at',
    header: ({ column }) => <SortableHeader column={column} label="Date" />,
    cell: ({ row }) => <time dateTime={row.original.at}>{new Date(row.original.at).toLocaleString()}</time>,
  }),
  columnHelper.accessor('durationMs', {
    header: ({ column }) => <SortableHeader column={column} label="Duration" />,
    cell: ({ getValue }) => `${(getValue() / 1000).toFixed(1)}s`,
  }),
  columnHelper.accessor((entry) => (entry.usage.inputTokens ?? 0) + (entry.usage.outputTokens ?? 0), {
    id: 'usage',
    header: ({ column }) => <SortableHeader column={column} label="Usage" />,
    cell: ({ row }) => describeUsage(row.original),
  }),
  columnHelper.accessor('stagedFileCount', {
    header: ({ column }) => <SortableHeader column={column} label="Staged" />,
    cell: ({ getValue }) => getValue() ?? '—',
  }),
  columnHelper.display({
    id: 'notes',
    header: 'Notes',
    cell: ({ row }) => {
      const entry = row.original;
      const notes: { key: string; text: string; tone?: 'error' | 'warn'; detail?: string }[] = [];
      if (entry.errorCode) notes.push({ key: 'error', text: entry.errorCode, tone: 'error' });
      if (entry.errorMessage) notes.push({ key: 'error-message', text: entry.errorMessage, tone: 'error', detail: entry.errorMessage });
      if (entry.splitOffered === true) notes.push({ key: 'split', text: `split: ${entry.splitGroups} commits` });
      if (entry.splitRejectedReason) notes.push({ key: 'rejected', text: `split refused: ${entry.splitRejectedReason}`, tone: 'warn', detail: entry.splitRejectedReason });
      if (entry.splitBlockedReason) notes.push({ key: 'blocked', text: `no split: ${entry.splitBlockedReason}`, detail: entry.splitBlockedReason });
      if (entry.contextTruncated === true) notes.push({ key: 'truncated', text: 'context trimmed' });
      if (notes.length === 0) return null;
      return (
        <div className="ai-log-row-notes">
          {notes.map((note) => <LogNote key={note.key} text={note.text} tone={note.tone} detail={note.detail} />)}
        </div>
      );
    },
  }),
]);

/**
 * Local history of AI runs. Reads the diagnostic log written by the main
 * process; it holds metadata only, never a prompt or any file content.
 */
export function AiLogDialog({ open, onOpenChange }: AiLogDialogProps) {
  const [entries, setEntries] = useState<AiLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await opentig.ai.log()); }
    catch (reason) { sileo.error({ title: 'Could not read the AI history', description: messageOf(reason) }); }
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

  const table = useTable({
    features,
    data: entries,
    columns,
    onSortingChange: setSorting,
    state: { sorting },
  });

  const clear = async () => {
    if (!window.confirm('Delete the whole AI history? This cannot be undone.')) return;
    try {
      await opentig.ai.clearLog();
      setEntries([]);
    } catch (reason) {
      sileo.error({ title: 'Could not clear the AI history', description: messageOf(reason) });
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
          {entries.length > 0 && (
            <div className="ai-log-table-wrap">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id}>
                          {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id} className={row.original.status === 'failed' ? 'ai-log-row-failed' : undefined}>
                      {row.getAllCells().map((cell) => (
                        <TableCell key={cell.id}><table.FlexRender cell={cell} /></TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

const NOTE_PREVIEW = 140;

function LogNote({ text, tone, detail }: { text: string; tone?: 'error' | 'warn' | undefined; detail?: string | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.length > NOTE_PREVIEW ? `${text.slice(0, NOTE_PREVIEW - 1)}…` : text;
  const className = `ai-log-note ${tone ?? ''}`;
  if (!detail) return <span className={className}>{preview}</span>;
  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<button type="button" className={className} onClick={() => setExpanded(true)} aria-label="Read generation details" />}>
          {preview}
        </TooltipTrigger>
        <TooltipContent className="max-w-md">{detail}</TooltipContent>
      </Tooltip>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogPopup className="name-dialog">
          <div className="name-dialog-content">
            <DialogTitle>Generation details</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap break-words">{detail}</DialogDescription>
            <div className="name-dialog-actions"><DialogClose render={<Button variant="outline" />}>Close</DialogClose></div>
          </div>
        </DialogPopup>
      </Dialog>
    </>
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
