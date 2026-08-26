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
import type { ProblemLogEntry } from '@shared/problems-log';
import { opentig } from '@/lib/opentig-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ProblemsLogDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

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

const columnHelper = createColumnHelper<typeof features, ProblemLogEntry>();

const columns = columnHelper.columns([
  columnHelper.accessor('level', {
    header: ({ column }) => <SortableHeader column={column} label="Level" />,
    cell: ({ getValue }) => {
      const level = getValue();
      return <Badge variant={level === 'warn' ? 'outline' : 'destructive'}>{level}</Badge>;
    },
  }),
  columnHelper.accessor('operation', {
    header: ({ column }) => <SortableHeader column={column} label="Operation" />,
    cell: ({ getValue }) => <strong>{getValue()}</strong>,
  }),
  columnHelper.accessor('code', {
    header: ({ column }) => <SortableHeader column={column} label="Code" />,
    cell: ({ getValue }) => getValue() ?? '—',
  }),
  columnHelper.accessor((entry) => new Date(entry.at).getTime(), {
    id: 'at',
    header: ({ column }) => <SortableHeader column={column} label="Date" />,
    cell: ({ row }) => <time dateTime={row.original.at}>{new Date(row.original.at).toLocaleString()}</time>,
  }),
  columnHelper.accessor('message', {
    header: ({ column }) => <SortableHeader column={column} label="Message" />,
    cell: ({ getValue }) => <span className="ai-log-model">{getValue()}</span>,
  }),
]);

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'An unexpected error occurred.';
}

export function ProblemsLogDialog({ open, onOpenChange }: ProblemsLogDialogProps) {
  const [entries, setEntries] = useState<ProblemLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await opentig.diagnostics.list()); }
    catch (reason) { sileo.error({ title: 'Could not read local problems', description: messageOf(reason) }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) void load(); }, [load, open]);

  const totals = useMemo(() => ({
    all: entries.length,
    errors: entries.filter((entry) => entry.level === 'error').length,
  }), [entries]);

  const table = useTable({
    features,
    data: entries,
    columns,
    onSortingChange: setSorting,
    state: { sorting },
  });

  const clear = async () => {
    if (!window.confirm('Delete the local problem history? This cannot be undone.')) return;
    try {
      await opentig.diagnostics.clear();
      setEntries([]);
    } catch (reason) {
      sileo.error({ title: 'Could not clear local problems', description: messageOf(reason) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="ai-log-dialog">
        <header className="ai-log-header">
          <div>
            <DialogTitle>Problem history</DialogTitle>
            <DialogDescription>Recent local failures on this machine. Prompts and file contents are never recorded.</DialogDescription>
          </div>
          <div className="ai-log-header-actions">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
              {loading ? <IconLoader4 className="animate-spin" /> : <IconRefresh />} Refresh
            </Button>
            <Button variant="ghost" size="sm" disabled={entries.length === 0} onClick={() => void clear()}><IconTrash /> Clear</Button>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close problem history" />}><IconX /></DialogClose>
          </div>
        </header>

        {entries.length > 0 && (
          <div className="ai-log-totals">
            <span><strong>{totals.all}</strong> recorded</span>
            <span><strong>{totals.errors}</strong> errors</span>
          </div>
        )}

        <div className="ai-log-body">
          {loading && entries.length === 0 && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Reading problems…" /></div>}
          {!loading && entries.length === 0 && <p className="ai-log-empty">No local problems recorded yet. Failed Git, file, and network operations will show up here.</p>}
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
                    <TableRow key={row.id} className={row.original.level === 'error' ? 'ai-log-row-failed' : undefined}>
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
