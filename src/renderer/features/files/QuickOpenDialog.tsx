import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const results = useMemo(
    () => files ? rankQuickOpenFiles(files, query, { includeIgnored, activePath, limit: 100 }) : [],
    [activePath, files, includeIgnored, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlightedIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setHighlightedIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (!open || results.length === 0) return;
    document.getElementById(optionId(listboxId, highlightedIndex))?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, listboxId, open, results.length]);

  const selectResult = (index: number) => {
    const result = results[index];
    if (result && onOpenFile(result.path)) onOpenChange(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setHighlightedIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setHighlightedIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      selectResult(highlightedIndex);
    }
  };

  const trimmedQuery = query.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="quick-open-dialog top-[max(64px,12vh)] w-[min(640px,calc(100vw-2.5rem))] -translate-y-0">
        <DialogTitle className="sr-only">Open file</DialogTitle>
        <DialogDescription className="sr-only">Search files in the current repository.</DialogDescription>
        <div className="quick-open-input-shell">
          <IconSearch aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search files by name or path"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={results.length > 0 ? optionId(listboxId, highlightedIndex) : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search files by name or path"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setHighlightedIndex(0); }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div id={listboxId} role="listbox" aria-label="Repository files" className="quick-open-results">
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
            <button
              id={optionId(listboxId, index)}
              key={result.path}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              className={`quick-open-result ${index === highlightedIndex ? 'active' : ''}`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectResult(index)}
            >
              <img className="quick-open-icon" src={getVsCodeFileIconUrl(result.path)} alt="" aria-hidden="true" draggable={false} />
              <span className="quick-open-name">{result.name}</span>
              <span className="quick-open-parent">{result.parentPath || 'Repository root'}</span>
            </button>
          ))}
        </div>
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

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}
