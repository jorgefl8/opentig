import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconChevronRight, IconLetterCase, IconLoader4, IconRegex, IconSearch, IconTextWrapDisabled } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildSearchRegex, type SearchOptions, type SearchResult } from '../../../shared/search';

const DEBOUNCE_MS = 250;

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
        .then((next) => { if (requestToken.current === token) { setResult(next); setError(null); } })
        .catch((reason: unknown) => {
          if (requestToken.current !== token) return;
          setResult(null);
          setError(reason instanceof Error ? reason.message : 'The search failed.');
        })
        .finally(() => { if (requestToken.current === token) setSearching(false); });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, options, query, repositoryId, revision]);

  const toggleFile = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  const summary = result
    ? result.totalMatches === 0
      ? 'No results'
      : `${result.totalMatches}${result.truncated ? '+' : ''} ${result.totalMatches === 1 ? 'result' : 'results'} in ${result.files.length} ${result.files.length === 1 ? 'file' : 'files'}`
    : null;

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
            {searching ? <ShimmeringText text="Searching…" /> : error ? <span className="search-error">{error}</span> : summary}
          </div>
        )}
      </div>
      <div className="search-results">
        {searching && !result && <div className="view-loading" role="status"><IconLoader4 className="spinner" /> <ShimmeringText text="Searching…" /></div>}
        {result?.files.map((file) => {
          const open = !collapsed.has(file.path);
          return (
            <section key={file.path} className="search-file">
              <button className="search-file-heading" onClick={() => toggleFile(file.path)} aria-expanded={open}>
                {open ? <IconChevronDown /> : <IconChevronRight />}
                <span className="search-file-name">{file.path}</span>
                <span className="search-file-count">{file.matches.length}</span>
              </button>
              {open && file.matches.map((match) => (
                <button key={`${file.path}:${match.line}`} className="search-match" onClick={() => onOpenFile(file.path)}>
                  <span className="search-match-line">{match.line}</span>
                  <span className="search-match-text">{highlight(match.text, highlighter)}</span>
                </button>
              ))}
            </section>
          );
        })}
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
