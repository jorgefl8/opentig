import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useMobileLayout } from '@/lib/use-mobile-layout';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQuery } from '@tanstack/react-query';
import { IconChevronDown, IconChevronRight, IconEyeOff, IconLoader4, IconReplace, IconReplaceFilled, IconSearch } from '@tabler/icons-react';
import { sileo } from 'sileo';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildSearchRegex, type SearchFileResult, type SearchMatch, type SearchOptions, type SearchResult } from '../../../shared/search';
import { queryKeys } from '@/lib/query-client';
import { opentig } from '@/lib/opentig-api';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';

const DEBOUNCE_MS = 250;
// Rows fill these heights; .search-file-heading and .search-match in index.css follow them.
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
  /** Open tabs with unsaved changes among the given paths, which must not be overwritten. */
  unsavedPathsAmong(paths: string[]): string[];
  onReplaced(paths: string[]): void;
}

export function SearchView({ repositoryId, active, revision, onOpenFile, unsavedPathsAmong, onReplaced }: SearchViewProps) {
  const mobile = useMobileLayout();
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [searchIgnored, setSearchIgnored] = useState(false);
  const [replaceIgnored, setReplaceIgnored] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceRevision, setReplaceRevision] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const revealingReplace = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const options = useMemo<SearchOptions>(
    () => ({ query, matchCase, wholeWord, regex, includeIgnored: searchIgnored }),
    [query, matchCase, wholeWord, regex, searchIgnored],
  );
  const highlighter = useMemo(() => buildSearchRegex(options), [options]);
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, DEBOUNCE_MS);
  const searchQuery = useQuery<SearchResult>({
    queryKey: queryKeys.search(repositoryId, {
      query: debouncedQuery, matchCase, wholeWord, regex, includeIgnored: searchIgnored, revision, replaceRevision,
    }),
    queryFn: () => opentig.repository.search(repositoryId, { ...options, query: debouncedQuery }),
    enabled: active && debouncedQuery.length > 0,
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[1] === repositoryId ? previousData : undefined,
  });
  const result = trimmedQuery ? searchQuery.data ?? null : null;
  const searching = Boolean(trimmedQuery) && (debouncedQuery !== trimmedQuery || searchQuery.isFetching);
  const error = trimmedQuery && searchQuery.error
    ? searchQuery.error instanceof Error ? searchQuery.error.message : 'The search failed.'
    : null;

  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);

  useEffect(() => {
    if (!searchQuery.data) return;
    // Ignored files are noise until asked for, so every fresh result folds them.
    setCollapsed(new Set(searchQuery.data.files.filter((file) => file.ignored).map((file) => file.path)));
  }, [searchQuery.data]);

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

  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual is intentionally imperative.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => mobile ? 44 : rows[index]?.kind === 'file' ? FILE_ROW_HEIGHT : MATCH_ROW_HEIGHT,
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === 'file' ? `file:${row.file.path}` : `match:${row.file.path}:${row.match.line}:${row.match.column ?? 1}`;
    },
    overscan: 12,
  });
  useEffect(() => { virtualizer.measure(); }, [virtualizer, mobile]);

  const toggleFile = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  const ignoredFiles = result?.files.filter((file) => file.ignored).length ?? 0;
  const replaceableFiles = result?.files.filter((file) => Boolean(file.revision) && (replaceIgnored || !file.ignored)) ?? [];

  const replace = async (scope: 'all' | SearchFileResult | { file: SearchFileResult; match: SearchMatch }) => {
    if (!result || replacing) return;
    const replaceScope = scope === 'all'
      ? { kind: 'all' as const, files: replaceableFiles.map((file) => ({ path: file.path, revision: file.revision! })) }
      : 'match' in scope
        ? { kind: 'match' as const, path: scope.file.path, revision: scope.file.revision!, line: scope.match.line, column: scope.match.column! }
        : { kind: 'file' as const, path: scope.path, revision: scope.revision! };
    if (replaceScope.kind === 'all') {
      if (result.truncated) { sileo.info({ title: 'Narrow the search before replacing all', description: 'The current result set is truncated.' }); return; }
      const count = replaceableFiles.reduce((total, file) => total + file.matches.length, 0);
      if (!count || !window.confirm(`Replace ${count} ${count === 1 ? 'occurrence' : 'occurrences'} in ${replaceableFiles.length} ${replaceableFiles.length === 1 ? 'file' : 'files'}?`)) return;
    } else if (replaceScope.kind === 'file' && scope !== 'all' && !('match' in scope) && scope.truncatedMatches) {
      // Replacing a file rewrites every occurrence in it, including the ones
      // beyond the listed limit, so the count on screen must not be implied.
      if (!window.confirm(`${scope.path} has more matches than the ${scope.matches.length} listed. Replace every occurrence in the file?`)) return;
    }

    const targetPaths = replaceScope.kind === 'all' ? replaceScope.files.map((file) => file.path) : [replaceScope.path];
    const unsaved = unsavedPathsAmong(targetPaths);
    if (unsaved.length > 0) {
      sileo.error({ title: 'Save open files before replacing in them', description: unsaved.join(', '), duration: 10_000 });
      return;
    }

    setReplacing(true);
    try {
      const outcome = await opentig.repository.replaceSearch(repositoryId, {
        options: { ...options, query: query.trim() }, replacement, scope: replaceScope,
      });
      if (outcome.status === 'stale') {
        sileo.error({ title: 'Files changed before replacement', description: 'Search results were refreshed without overwriting anything.' });
      } else if (outcome.status === 'no-match') {
        sileo.info({ title: 'No matching text to replace' });
      } else {
        sileo.success({ title: `Replaced ${outcome.replacements} ${outcome.replacements === 1 ? 'occurrence' : 'occurrences'}`, description: `${outcome.files.length} ${outcome.files.length === 1 ? 'file' : 'files'} changed` });
        onReplaced(outcome.files);
      }
      setReplaceRevision((value) => value + 1);
    } catch (reason) {
      sileo.error({ title: 'Could not replace search results', description: reason instanceof Error ? reason.message : 'Unknown error', duration: 10_000 });
    } finally { setReplacing(false); }
  };

  return (
    <div className="search-view">
      <div className="search-controls">
        <div className="search-query-row">
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
              <SearchToggle label="Match case" active={matchCase} onToggle={() => setMatchCase((value) => !value)}>Aa</SearchToggle>
              <SearchToggle label="Match whole word" active={wholeWord} onToggle={() => setWholeWord((value) => !value)}>ab</SearchToggle>
              <SearchToggle label="Use regular expression" active={regex} onToggle={() => setRegex((value) => !value)}>.*</SearchToggle>
            </span>
          </div>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant={searchIgnored ? 'secondary' : 'ghost'} size="icon-xs" className="change-action-button" aria-label="More search options" />} />}><IconChevronDown /></TooltipTrigger>
              <TooltipContent>More search options</TooltipContent>
            </Tooltip>
            <DropdownMenuContent finalFocus={() => {
              if (!revealingReplace.current) return true;
              revealingReplace.current = false;
              return replaceInputRef.current ?? true;
            }}>
              <DropdownMenuCheckboxItem checked={searchIgnored} onCheckedChange={setSearchIgnored}>Include ignored files</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {replaceOpen ? (
                // Hiding the field must not hide a replacement that is still in effect.
                <DropdownMenuItem disabled={replacement !== ''} className="justify-between" onClick={() => setReplaceOpen(false)}>
                  Hide replace {replacement !== '' && <span className="text-(length:--text-meta) text-muted-foreground">Clear it first</span>}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => { revealingReplace.current = true; setReplaceOpen(true); }}>Replace…</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {replaceOpen && (
          <div className="search-query-row">
            <div className="search-input">
              <IconReplace aria-hidden="true" />
              <input ref={replaceInputRef} value={replacement} spellCheck={false} placeholder="Replace" aria-label="Replace with" onChange={(event) => setReplacement(event.target.value)} />
            </div>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="change-action-button" disabled={replacing || replaceableFiles.length === 0 || Boolean(result?.truncated)} aria-label="Replace all search results" onClick={() => void replace('all')} />}><IconReplaceFilled /></TooltipTrigger>
              <TooltipContent>{result?.truncated ? 'Narrow the search to replace all' : 'Replace all'}</TooltipContent>
            </Tooltip>
          </div>
        )}
        {replaceOpen && ignoredFiles > 0 && (
          <label className="search-include-ignored"><input type="checkbox" checked={replaceIgnored} onChange={(event) => setReplaceIgnored(event.target.checked)} /> Include ignored files when replacing</label>
        )}
        {/* The results pane shows the spinner for the first search, so the summary
            stays out of the way until there is a result to describe or refresh. */}
        {query.trim() !== '' && (result !== null || !searching) && (
          <div className="search-summary">
            {searching ? <ShimmeringText text="Searching…" /> : error ? <span className="search-error">{error}</span> : result && (
              <>
                <span>
                  {result.totalMatches === 0
                    ? 'No results'
                    : `${result.totalMatches - result.ignoredMatches}${result.truncated ? '+' : ''} ${result.totalMatches - result.ignoredMatches === 1 ? 'result' : 'results'} in ${result.files.length - ignoredFiles} ${result.files.length - ignoredFiles === 1 ? 'file' : 'files'}`}
                </span>
                {result.ignoredMatches > 0 && (
                  <span> · {result.ignoredMatches} in {ignoredFiles} ignored {ignoredFiles === 1 ? 'file' : 'files'}</span>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="search-results">
        {!trimmedQuery && <p className="empty-list">Type to search every file.</p>}
        {searching && !result && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Searching…" /></div>}
        <div className="search-rows virtual-list" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div key={virtualRow.key} className="virtual-row" style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}>
                {row.kind === 'file' ? (
                  <div className={`search-file-heading ${row.file.ignored ? 'ignored' : ''}`}>
                    <button className="search-file-toggle" onClick={() => toggleFile(row.file.path)} aria-expanded={row.open}>
                      {row.open ? <IconChevronDown /> : <IconChevronRight />}
                      <img className="vscode-tree-icon" src={getVsCodeFileIconUrl(row.file.path)} alt="" aria-hidden="true" draggable={false} />
                      <span className="search-file-name"><bdi>{row.file.path}</bdi></span>
                      {row.file.ignored && (
                        <Tooltip>
                          <TooltipTrigger render={<span className="search-file-ignored-badge" />}><IconEyeOff /></TooltipTrigger>
                          <TooltipContent>Ignored by Git</TooltipContent>
                        </Tooltip>
                      )}
                      <span className="plain-count">{row.file.matches.length}</span>
                    </button>
                    {replaceOpen && row.file.revision && (!row.file.ignored || replaceIgnored) && (
                      <Tooltip>
                        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="search-replace-action change-action-button" disabled={replacing} aria-label={`Replace all in ${row.file.path}`} onClick={() => void replace(row.file)} />}><IconReplaceFilled /></TooltipTrigger>
                        <TooltipContent>Replace all in this file</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ) : (
                  <div className="search-match">
                    <button className="search-match-open" onClick={() => onOpenFile(row.file.path)}>
                      <span className="search-match-line">{row.match.line}:{row.match.column ?? 1}</span>
                      <span className="search-match-text">{highlight(row.match.text, highlighter)}</span>
                    </button>
                    {replaceOpen && row.file.revision && row.match.column && (!row.file.ignored || replaceIgnored) && (
                      <Tooltip>
                        <TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="search-replace-action change-action-button" disabled={replacing} aria-label={`Replace match on line ${row.match.line}`} onClick={() => void replace({ file: row.file, match: row.match })} />}><IconReplace /></TooltipTrigger>
                        <TooltipContent>Replace this match</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function SearchToggle({ label, active, onToggle, children }: { label: string; active: boolean; onToggle(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button variant="ghost" size="icon-xs" className="size-5.5 rounded-sm font-mono text-(length:--text-meta) font-medium text-muted-foreground aria-pressed:bg-primary/20 aria-pressed:text-primary aria-pressed:hover:bg-primary/25 aria-pressed:hover:text-primary" aria-label={label} aria-pressed={active} onClick={onToggle} />
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
