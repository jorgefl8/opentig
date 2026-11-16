import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconArrowDown, IconArrowRight, IconArrowUp, IconBolt, IconBrandGithub, IconCircleCheck, IconCircleX, IconClock, IconExternalLink,
  IconFiles, IconFolder, IconGitBranch, IconGitCommit, IconGitCompare, IconGitMerge, IconGitPullRequest, IconHierarchy2, IconHistory,
  IconKeyboard, IconRefresh, IconRestore, IconSearch, IconSettings, IconTag,
} from '@tabler/icons-react';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { ShimmeringText } from '@/components/ui/shimmering-text';
import { Spinner } from '@/components/ui/spinner';
import { getVsCodeFileIconUrl } from '@/lib/vscode-icons';
import { actionRunListOptions, listedRun, runsOfPages } from '@/features/actions/action-queries';
import { useQuickOpenResults } from '@/features/files/use-quick-open-results';
import { branchItems, commandItems, commitItem, placeItem, pullRequestItem, repositoryItems, runItem, type PaletteIcon, type PaletteItem } from './palette-items';
import { PALETTE_MODES, highlightRange, modeInfo, rankBy, readFileQuery, readInput, stepMode } from './palette-model';
import type { PaletteActions, PaletteMode, PaletteRequest, PaletteState } from './palette-types';
import './palette.css';

interface CommandPaletteProps {
  request: PaletteRequest;
  state: PaletteState;
  actions: PaletteActions;
  onClose(): void;
}

/** Results listed at most per kind: enough to scroll, few enough to draw at once. */
const LIST_LIMIT = 50;
const RECENT_PLACES = 5;

interface PaletteGroup { label: string; items: PaletteItem[] }
interface PaletteView {
  groups: PaletteGroup[];
  /** Shown instead of results: still loading, or nothing to list. */
  notice: { kind: 'loading'; text: string } | { kind: 'empty'; title: string; hint: string } | null;
  /** The help under an empty field on Files. */
  help: boolean;
}

/**
 * Ctrl+P and Ctrl+K: one search over files, commands, branches, commits, pull
 * requests, runs and repositories, each a tab with its own sign. Rows that open
 * a place are a step of Back and Forward; rows that change the repository run the
 * app's own action, with its guards and confirmations.
 */
export function CommandPalette({ request, state, actions, onClose }: CommandPaletteProps) {
  const [opening, setOpening] = useState(request);
  const [mode, setMode] = useState<PaletteMode>(request.mode);
  const [text, setText] = useState('');
  // Ctrl+P or Ctrl+K again while it is open starts it afresh, in the mode asked for.
  if (opening.id !== request.id) {
    setOpening(request);
    setMode(request.mode);
    setText('');
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const info = modeInfo(mode);
  const fileQuery = mode === 'files' ? readFileQuery(text) : null;
  const { results: fileResults, pending: filesPending } = useQuickOpenResults(state.files, fileQuery?.name ?? '', state.includeIgnored, state.activePath, mode === 'files');
  // The Actions list as the GitHub section reads it, asked for once when the tab opens; never per keystroke, and not polled from here.
  const runsQuery = useInfiniteQuery({
    ...actionRunListOptions(state.repositoryId, null),
    enabled: mode === 'runs' && state.github !== null && state.githubReady,
    refetchInterval: false,
    staleTime: 60_000,
  });
  const queryClient = useQueryClient();
  const commitsMissing = state.commits === null;
  const loadCommits = actions.loadCommits;
  useEffect(() => { if (mode === 'commits' && commitsMissing) loadCommits(); }, [commitsMissing, loadCommits, mode]);
  useEffect(() => { window.requestAnimationFrame(() => inputRef.current?.focus()); }, [request.id]);

  const view = useMemo<PaletteView>(() => {
    const query = text.trim();
    switch (mode) {
      case 'files': {
        if (state.files === null || filesPending) return { groups: [], notice: { kind: 'loading', text: filesPending ? 'Searching files…' : 'Loading files…' }, help: false };
        const line = fileQuery?.line ?? null;
        const files: PaletteItem[] = fileResults.map((result) => ({
          key: `file:${result.path}`, icon: 'file', path: result.path, title: result.name, detail: result.parentPath || 'Repository root',
          verb: 'open', verbLabel: line ? `Open at line ${line}` : 'Open', disabled: null,
          run: () => actions.openFile(result.path, line),
        }));
        if (!query) {
          const names = { pull: (number: number) => state.pulls?.find((pull) => pull.number === number), run: (runId: number) => listedRun(queryClient, state.repositoryId, runId) };
          const places = actions.recentPlaces().slice(0, RECENT_PLACES).map((location) => placeItem(location, names, actions));
          return { groups: [{ label: 'Recent places', items: places }, { label: 'Files', items: files }], notice: null, help: true };
        }
        if (files.length === 0) {
          return {
            groups: [{ label: 'Instead', items: [{
              key: 'search-in-files', icon: 'search', title: `Search for “${query}” inside files`, detail: 'Opens the Search section',
              verb: 'open', verbLabel: 'Open', disabled: null, run: () => { actions.searchInFiles(query); return true; },
            }] }],
            notice: { kind: 'empty', title: `No files match “${fileQuery?.name ?? query}”`, hint: 'Looking for something else? Try another tab.' },
            help: false,
          };
        }
        return { groups: [{ label: 'Files', items: files }], notice: null, help: false };
      }
      case 'commands':
        return ranked('Commands', rankBy(commandItems(state, actions), query, (item) => [item.title, item.detail], LIST_LIMIT), query, 'commands');
      case 'branches':
        if (state.branches.length === 0) return empty('No branches yet', 'This repository has no branches to list.');
        return ranked('Branches', rankBy(branchItems(state, actions), query, (item) => [item.title, item.detail], LIST_LIMIT), query, 'branches');
      case 'commits': {
        if (state.commits === null) return { groups: [], notice: { kind: 'loading', text: 'Loading commits…' }, help: false };
        if (state.commits.length === 0) return empty('No commits yet', 'This repository has no commits.');
        const commits = rankBy(state.commits, query, (commit) => [commit.subject, commit.oid, commit.author], LIST_LIMIT);
        return ranked('Commits', commits.map((commit) => commitItem(commit, actions)), query, 'commits');
      }
      case 'pulls': {
        if (!state.github) return empty('This repository isn’t on GitHub', 'Pull requests show for repositories whose remote is on GitHub.');
        if (state.pulls === null) {
          if (state.pullsError) return empty('Pull requests couldn’t be read', state.pullsError);
          return state.pullsLoading || state.githubReady
            ? { groups: [], notice: { kind: 'loading', text: 'Loading pull requests…' }, help: false }
            : empty('GitHub isn’t set up', 'Connect GitHub in Settings → GitHub to list pull requests.');
        }
        if (state.pulls.length === 0) return empty('No pull requests', 'The GitHub section’s filter lists none.');
        const pulls = rankBy(state.pulls, query, (pull) => [`#${pull.number} ${pull.title}`, String(pull.number), pull.headRefName, pull.author], LIST_LIMIT);
        return ranked('Pull requests', pulls.map((pull) => pullRequestItem(pull, actions)), query, 'pulls');
      }
      case 'runs': {
        if (!state.github) return empty('This repository isn’t on GitHub', 'Workflow runs show for repositories whose remote is on GitHub.');
        if (!state.githubReady) return empty('GitHub isn’t set up', 'Connect GitHub in Settings → GitHub to list workflow runs.');
        if (runsQuery.error && !runsQuery.data) return empty('Workflow runs couldn’t be read', runsQuery.error instanceof Error ? runsQuery.error.message : 'GitHub didn’t answer.');
        if (!runsQuery.data) return { groups: [], notice: { kind: 'loading', text: 'Loading workflow runs…' }, help: false };
        const runs = runsOfPages(runsQuery.data.pages);
        if (runs.length === 0) return empty('No workflow runs yet', 'GitHub Actions hasn’t run in this repository.');
        const found = rankBy(runs, query, (run) => [`${run.workflowName} #${run.number} ${run.title}`, run.branch ?? '', String(run.number)], LIST_LIMIT);
        return ranked('Workflow runs', found.map((run) => runItem(run, actions)), query, 'runs');
      }
      case 'repositories':
        return ranked('Repositories', rankBy(repositoryItems(state, actions), query, (item) => [item.title, item.detail], LIST_LIMIT), query, 'repositories');
    }
  }, [actions, fileQuery?.line, fileQuery?.name, fileResults, filesPending, mode, queryClient, runsQuery.data, runsQuery.error, state, text]);

  const items = useMemo(() => view.groups.flatMap((group) => group.items), [view]);
  const highlight = mode === 'files' ? fileQuery?.name ?? '' : text.trim();

  const switchMode = (next: PaletteMode) => {
    setMode(next);
    inputRef.current?.focus();
  };
  const onInput = (value: string) => {
    const next = readInput(value, mode, text);
    if (next.mode !== mode) setMode(next.mode);
    setText(next.text);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      switchMode(stepMode(mode, event.shiftKey ? -1 : 1));
    } else if (event.key === 'Backspace' && text === '' && mode !== 'files') {
      event.preventDefault();
      switchMode('files');
    }
  };
  const choose = (item: PaletteItem) => {
    if (item.disabled) return;
    if (item.run()) onClose();
  };

  // Each row's place in the whole list, which the keyboard moves through across groups.
  const offsets = view.groups.map((_, groupIndex) => view.groups.slice(0, groupIndex).reduce((sum, group) => sum + group.items.length, 0));
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPopup className="quick-open-dialog command-palette top-[max(64px,12vh)] w-[min(640px,calc(100vw-2.5rem))] -translate-y-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search files, commands, branches, commits, pull requests, workflow runs and repositories. Press Tab, or type a tab’s sign first, to change what you search.</DialogDescription>
        <Autocomplete.Root
          items={items}
          value={text}
          onValueChange={onInput}
          itemToStringValue={(item) => item.key}
          mode="none"
          inline
          open
          autoHighlight="always"
          onOpenChange={(nextOpen, eventDetails) => {
            if (!nextOpen && eventDetails.reason !== 'item-press') onClose();
          }}
        >
          <div className="quick-open-input-shell">
            <IconSearch aria-hidden="true" />
            <Autocomplete.Input
              ref={inputRef}
              aria-label={info.placeholder}
              autoComplete="off"
              spellCheck={false}
              maxLength={1_000}
              placeholder={info.placeholder}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="palette-tabs" role="tablist" aria-label="What to search">
            {PALETTE_MODES.map((item) => (
              <button
                key={item.mode}
                type="button"
                role="tab"
                aria-selected={item.mode === mode}
                aria-controls={listId}
                // Tab in the field moves between them; the field keeps the focus.
                tabIndex={-1}
                className="palette-tab"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => switchMode(item.mode)}
              >
                {item.label}
                {item.prefix && <span className="palette-tab-sign" aria-hidden="true">{item.prefix}</span>}
              </button>
            ))}
          </div>
          <Autocomplete.List id={listId} aria-label={info.listLabel} className="quick-open-results palette-results">
            {view.notice?.kind === 'loading' && (
              <div className="quick-open-status loading" role="status"><Spinner className="view-spinner" /> <ShimmeringText text={view.notice.text} /></div>
            )}
            {view.notice?.kind === 'empty' && (
              <div className="quick-open-status palette-empty" role="status">
                <IconSearch aria-hidden="true" />
                <strong>{view.notice.title}</strong>
                <p>{view.notice.hint}</p>
              </div>
            )}
            {view.groups.map((group, groupIndex) => <Fragment key={group.label}>
              {group.items.length > 0 && (
                <Autocomplete.Group className="palette-group">
                  <Autocomplete.GroupLabel className="palette-group-label">{group.label}</Autocomplete.GroupLabel>
                  {group.items.map((item, itemIndex) => (
                    <PaletteRow key={item.key} item={item} index={offsets[groupIndex]! + itemIndex} highlight={highlight} onChoose={choose} />
                  ))}
                </Autocomplete.Group>
              )}
              {/* Under the recent places, before the files. */}
              {view.help && groupIndex === 0 && <PaletteHelp />}
            </Fragment>)}
          </Autocomplete.List>
        </Autocomplete.Root>
        <footer className="quick-open-footer">
          <span className="quick-open-hints">
            <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
            <span><kbd>↵</kbd> open or run</span>
            <span className="palette-hint-tab"><kbd>Tab</kbd> next kind</span>
            <span><kbd>Esc</kbd> close</span>
          </span>
          {!view.notice || view.notice.kind === 'empty' ? <span className="quick-open-count" aria-live="polite">{countLabel(items.length, mode)}</span> : null}
        </footer>
      </DialogPopup>
    </Dialog>
  );
}

function ranked(label: string, items: PaletteItem[], query: string, mode: PaletteMode): PaletteView {
  if (items.length === 0) {
    return { groups: [], notice: { kind: 'empty', title: query ? `No ${modeInfo(mode).noun} match “${query}”` : `No ${modeInfo(mode).noun}`, hint: 'Check the spelling, or try another tab.' }, help: false };
  }
  return { groups: [{ label, items }], notice: null, help: false };
}

function empty(title: string, hint: string): PaletteView {
  return { groups: [], notice: { kind: 'empty', title, hint }, help: false };
}

function countLabel(count: number, mode: PaletteMode): string {
  if (mode === 'files' && count === 100) return 'Top 100 matches';
  return `${count} ${count === 1 ? 'result' : 'results'}`;
}

function PaletteHelp() {
  return (
    <div className="palette-help" role="note">
      Type a file name. Add <b>:40</b> to go to a line. <kbd>Tab</kbd> or a sign such as <kbd>&gt;</kbd> changes what you search.
    </div>
  );
}

const ICONS: Record<Exclude<PaletteIcon, 'file'>, typeof IconSearch> = {
  changes: IconGitCompare, files: IconFiles, history: IconHistory, github: IconBrandGithub, search: IconSearch,
  pull: IconArrowDown, push: IconArrowUp, refresh: IconRefresh, discard: IconRestore, 'pull-request': IconGitPullRequest,
  merged: IconGitMerge, folder: IconFolder, settings: IconSettings, keyboard: IconKeyboard, external: IconExternalLink,
  branch: IconGitBranch, commit: IconGitCommit, 'run-success': IconCircleCheck, 'run-failure': IconCircleX,
  'run-pending': IconClock, release: IconTag, worktree: IconHierarchy2,
};

function PaletteRow({ item, index, highlight, onChoose }: { item: PaletteItem; index: number; highlight: string; onChoose(item: PaletteItem): void }) {
  const Icon = item.icon === 'file' ? null : ICONS[item.icon];
  const changes = item.verb === 'run' || item.verb === 'ask';
  const VerbIcon = changes ? IconBolt : item.verb === 'out' ? IconExternalLink : IconArrowRight;
  return (
    <Autocomplete.Item
      value={item}
      index={index}
      disabled={item.disabled !== null}
      className="quick-open-result palette-row"
      data-verb={item.verb}
      onClick={() => onChoose(item)}
    >
      <span className="palette-icon" aria-hidden="true">
        {Icon ? <Icon /> : <img src={getVsCodeFileIconUrl(item.path ?? item.title)} alt="" draggable={false} />}
      </span>
      <span className="palette-text">
        <span className="palette-title"><Marked text={item.title} query={highlight} /></span>
        {(item.disabled ?? item.detail) && <span className="palette-detail">{item.disabled ?? item.detail}</span>}
      </span>
      <span className="palette-verb">
        {item.keys && <span className="palette-keys" aria-hidden="true">{item.keys.map((key, keyIndex) => <kbd key={`${keyIndex}:${key}`}>{key}</kbd>)}</span>}
        {item.disabled === null && <kbd className="palette-enter" aria-hidden="true">↵</kbd>}
        <b>{item.disabled !== null ? 'Unavailable' : item.verbLabel}</b>
        {item.verb !== 'current' && <VerbIcon aria-hidden="true" />}
      </span>
    </Autocomplete.Item>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  const range = highlightRange(text, query);
  if (!range) return <>{text}</>;
  return <>{text.slice(0, range[0])}<mark>{text.slice(range[0], range[1])}</mark>{text.slice(range[1])}</>;
}
