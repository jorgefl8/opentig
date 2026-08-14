import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconChevronDown, IconChevronRight, IconEyeOff, IconLetterCase, IconLoader4, IconRegex, IconSearch, IconTextWrapDisabled } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildSearchRegex, type SearchFileResult, type SearchMatch, type SearchOptions, type SearchResult } from '../../../shared/search';

const DEBOUNCE_MS = 250;
const FILE_ROW_HEIGHT = 28;
const MATCH_ROW_HEIGHT = 24;

type SearchRow =
  | { kind: 'file'; file: SearchFileResult; open: boolean }
  | { kind: 'match'; file: SearchFileResult; match: SearchMatch };

interface SearchViewProps {
  repositoryId: string;
  active: boolean;
  /** Changes whenever the working tree changed, so results can be refreshed. */
  revision: number;
  onOpenFile(path: string): void;
}

export function SearchView({ repositoryId, active, revision, onOpenFile }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestToken = useRef(0);

  const options = useMemo<SearchOptions>(() => ({ query, matchCase, wholeWord, regex }), [query, matchCase, wholeWord, regex]);
  const highlighter = useMemo(() => buildSearchRegex(options), [options]);

  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);

  useEffect(() => {
    if (!active) return;
    const trimmed = query.trim();
    if (!trimmed) { setResult(null); setError(null); setSearching(false); return; }
    const token = ++requestToken.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void window.justgit.repository.search(repositoryId, { ...options, query: trimmed })
        .then((next) => {
          if (requestToken.current !== token) return;
          setResult(next);
          setError(null);
          // Ignored files are noise until asked for, so they arrive folded.
          setCollapsed(new Set(next.files.filter((file) => file.ignored).map((file) => file.path)));
        })
        .catch((reason: unknown) => {
          if (requestToken.current !== token) return;
          setResult(null);
          setError(reason instanceof Error ? reason.message : 'The search failed.');
        })
        .finally(() => { if (requestToken.current === token) setSearching(false); });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, options, query, repositoryId, revision]);

  const rows = useMemo<SearchRow[]>(() => {
    if (!result) return [];
    const flattened: SearchRow[] = [];
    for (const file of result.files) {
      const open = !collapsed.has(file.path);
      flattened.push({ kind: 'file', file, open });
      if (open) for (const match of file.matches) flattened.push({ kind: 'match', file, match });
    }
    return flattened;
  }, [collapsed, result]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.kind === 'file' ? FILE_ROW_HEIGHT : MATCH_ROW_HEIGHT,
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === 'file' ? `file:${row.file.path}` : `match:${row.file.path}:${row.match.line}`;
    },
    overscan: 12,
  });

  const toggleFile = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  const ignoredFiles = result?.files.filter((file) => file.ignored).length ?? 0;

  return (
    <div className="search-view">
      <div className="search-controls">
        <div className="search-input">
          <IconSearch aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            spellCheck={false}
            placeholder="Search in repository"
            aria-label="Search in repository"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="search-toggles">
            <SearchToggle label="Match case" active={matchCase} onToggle={() => setMatchCase((value) => !value)}><IconLetterCase /></SearchToggle>
            <SearchToggle label="Match whole word" active={wholeWord} onToggle={() => setWholeWord((value) => !value)}><IconTextWrapDisabled /></SearchToggle>
            <SearchToggle label="Use regular expression" active={regex} onToggle={() => setRegex((value) => !value)}><IconRegex /></SearchToggle>
          </span>
        </div>
        {query.trim() !== '' && (
          <div className="search-summary">
            {searching ? <ShimmeringText text="Searching…" /> : error ? <span className="search-error">{error}</span> : result && (
              <>
                <span>
                  {result.totalMatches === 0
                    ? 'No results'
                    : `${result.totalMatches - result.ignoredMatches}${result.truncated ? '+' : ''} ${result.totalMatches - result.ignoredMatches === 1 ? 'result' : 'results'} in ${result.files.length - ignoredFiles} ${result.files.length - ignoredFiles === 1 ? 'file' : 'files'}`}
                </span>
                {result.ignoredMatches > 0 && (
                  <span className="search-summary-ignored">· {result.ignoredMatches} in {ignoredFiles} ignored {ignoredFiles === 1 ? 'file' : 'files'}</span>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="search-results">
        {searching && !result && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Searching…" /></div>}
        <div className="search-rows virtual-list" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div key={virtualRow.key} className="virtual-row" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}>
                {row.kind === 'file' ? (
                  <button
                    className={`search-file-heading ${row.file.ignored ? 'ignored' : ''}`}
                    onClick={() => toggleFile(row.file.path)}
                    aria-expanded={row.open}
                  >
                    {row.open ? <IconChevronDown /> : <IconChevronRight />}
                    <span className="search-file-name">{row.file.path}</span>
                    {row.file.ignored && (
                      <Tooltip>
                        <TooltipTrigger render={<span className="search-file-ignored-badge" />}><IconEyeOff /></TooltipTrigger>
                        <TooltipContent>Ignored by Git</TooltipContent>
                      </Tooltip>
                    )}
                    <span className="search-file-count">{row.file.matches.length}</span>
                  </button>
                ) : (
                  <button className="search-match" onClick={() => onOpenFile(row.file.path)}>
                    <span className="search-match-line">{row.match.line}</span>
                    <span className="search-match-text">{highlight(row.match.text, highlighter)}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SearchToggle({ label, active, onToggle, children }: { label: string; active: boolean; onToggle(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button variant="ghost" size="icon-xs" className="search-toggle" aria-label={label} aria-pressed={active} onClick={onToggle} />
      }>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Splits the matched line so the matched fragments can be emphasized. */
function highlight(text: string, pattern: RegExp | null): React.ReactNode {
  const trimmed = text.replace(/^\s+/, '');
  if (!pattern) return trimmed;
  pattern.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let match = pattern.exec(trimmed); match !== null; match = pattern.exec(trimmed)) {
    if (match[0] === '') { pattern.lastIndex += 1; continue; }
    parts.push(
      <Fragment key={`${match.index}-plain`}>{trimmed.slice(cursor, match.index)}</Fragment>,
      <mark key={`${match.index}-hit`}>{match[0]}</mark>,
    );
    cursor = match.index + match[0].length;
  }
  if (parts.length === 0) return trimmed;
  parts.push(<Fragment key="tail">{trimmed.slice(cursor)}</Fragment>);
  return parts;
}
