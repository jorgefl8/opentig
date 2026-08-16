import { useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { IconFileSearch, IconLoader4, IconSearch } from '@tabler/icons-react';
import type { FileTreeEntry } from '@shared/git-types';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { rankQuickOpenFiles } from './quick-open';

interface QuickOpenDialogProps {
  open: boolean;
  files: FileTreeEntry[] | null;
  includeIgnored: boolean;
  activePath: string | null;
  onOpenChange(open: boolean): void;
  onOpenFile(path: string): boolean;
}

export function QuickOpenDialog({ open, files, includeIgnored, activePath, onOpenChange, onOpenFile }: QuickOpenDialogProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => files ? rankQuickOpenFiles(files, query, { includeIgnored, activePath, limit: 100 }) : [],
    [activePath, files, includeIgnored, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const selectResult = (path: string) => {
    if (onOpenFile(path)) onOpenChange(false);
  };

  const trimmedQuery = query.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="quick-open-dialog top-[max(64px,12vh)] w-[min(640px,calc(100vw-2.5rem))] -translate-y-0">
        <DialogTitle className="sr-only">Open file</DialogTitle>
        <DialogDescription className="sr-only">Search files in the current repository.</DialogDescription>
        <Autocomplete.Root
          items={results}
          value={query}
          onValueChange={setQuery}
          itemToStringValue={(item) => item.path}
          mode="none"
          inline
          open={open}
          autoHighlight="always"
          onOpenChange={(nextOpen, eventDetails) => {
            if (!nextOpen && eventDetails.reason !== 'item-press') onOpenChange(false);
          }}
        >
          <div className="quick-open-input-shell">
            <IconSearch aria-hidden="true" />
            <Autocomplete.Input
              ref={inputRef}
              aria-label="Search files by name or path"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search files by name or path"
            />
          </div>
          <Autocomplete.List aria-label="Repository files" className="quick-open-results">
            {files === null ? (
              <div className="quick-open-status loading" role="status">
                <IconLoader4 className="spinner" aria-hidden="true" /> <ShimmeringText text="Loading files…" />
              </div>
            ) : results.length === 0 ? (
              <div className="quick-open-status" role="status">
                <IconFileSearch aria-hidden="true" />
                <strong>No matching files</strong>
                <p>{trimmedQuery ? <>Nothing matches <em>{trimmedQuery}</em> in this repository.</> : 'This repository has no files to open.'}</p>
              </div>
            ) : results.map((result, index) => (
              <Autocomplete.Item
                key={result.path}
                value={result}
                index={index}
                className="quick-open-result"
                onClick={() => selectResult(result.path)}
              >
                <img className="quick-open-icon" src={getVsCodeFileIconUrl(result.path)} alt="" aria-hidden="true" draggable={false} />
                <span className="quick-open-name">{result.name}</span>
                <span className="quick-open-parent">{result.parentPath || 'Repository root'}</span>
              </Autocomplete.Item>
            ))}
          </Autocomplete.List>
        </Autocomplete.Root>
        <footer className="quick-open-footer">
          <span className="quick-open-hints">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
          </span>
          {files !== null && (
            <span className="quick-open-count">
              {results.length === 100 ? 'Top 100 matches' : `${results.length} ${results.length === 1 ? 'file' : 'files'}`}
            </span>
          )}
        </footer>
      </DialogPopup>
    </Dialog>
  );
}
