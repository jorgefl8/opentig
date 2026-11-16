import type { ActionRunSummary, PullRequestSummary, RecentRepository } from '@shared/contracts';
import type { BranchInfo, CommitInfo } from '@shared/git-types';
import { formatTimeAgo } from '@shared/date-format';
import type { NavigationLocation, SidebarView } from '@/app/navigation/location';
import { actionStatusLabel, actionTone } from '@/features/actions/action-status';
import { parentDirectory } from '@/features/files/file-tree';
import type { PaletteActions, PaletteState } from './palette-types';

/**
 * What choosing a row does. `open` goes somewhere in OpenTig, which Back returns
 * from; `run` changes the repository, and Back does not undo it; `ask` runs
 * something that asks first; `out` leaves OpenTig for the browser.
 */
export type PaletteVerb = 'open' | 'run' | 'ask' | 'out' | 'current';

export type PaletteIcon =
  | 'file' | 'changes' | 'files' | 'history' | 'github' | 'search' | 'pull' | 'push' | 'refresh' | 'discard'
  | 'pull-request' | 'merged' | 'folder' | 'settings' | 'keyboard' | 'external' | 'branch' | 'commit'
  | 'run-success' | 'run-failure' | 'run-pending' | 'release' | 'worktree';

export interface PaletteItem {
  key: string;
  icon: PaletteIcon;
  /** For a file's own icon. */
  path?: string;
  title: string;
  detail: string;
  verb: PaletteVerb;
  verbLabel: string;
  /** Keys that do the same without the palette, each pressed in turn or held together as written. */
  keys?: string[];
  /** Why it can't be chosen now; shown, and the row can't be chosen. */
  disabled: string | null;
  /** Runs it. False keeps the palette open, when the app turned it down. */
  run(): boolean;
}

const SECTIONS: { view: SidebarView; label: string; icon: PaletteIcon; letter: string; digit: number }[] = [
  { view: 'changes', label: 'Changes', icon: 'changes', letter: 'C', digit: 1 },
  { view: 'files', label: 'Files', icon: 'files', letter: 'F', digit: 2 },
  { view: 'history', label: 'History', icon: 'history', letter: 'H', digit: 3 },
  { view: 'prs', label: 'GitHub', icon: 'github', letter: 'P', digit: 4 },
  { view: 'search', label: 'Search', icon: 'search', letter: 'S', digit: 5 },
];

export function sectionLabel(view: SidebarView): string {
  return SECTIONS.find((section) => section.view === view)!.label;
}

const done = (action: () => void) => () => { action(); return true; };
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Why nothing that changes the repository can run now, the same waits the app's own buttons have. */
export function repositoryChangeBlocked(state: Pick<PaletteState, 'status' | 'unconfirmed' | 'busy' | 'syncBusy'>): string | null {
  if (!state.status || state.unconfirmed) return 'Waiting for the repository to be read';
  if (state.status.readOnly) return `Finish the ${state.status.operation ?? 'Git operation'} in progress first`;
  if (state.busy || state.syncBusy) return 'Wait for the current operation to finish';
  return null;
}

/** Every command, with its state now. The order is the list's order before anything is typed. */
export function commandItems(state: PaletteState, actions: PaletteActions): PaletteItem[] {
  const items: PaletteItem[] = SECTIONS.map((section) => ({
    key: `section:${section.view}`,
    icon: section.icon,
    title: `Go to ${section.label}`,
    detail: state.view === section.view ? 'Section · open now' : 'Section',
    verb: 'open',
    verbLabel: 'Open',
    keys: state.desktop ? ['Ctrl', String(section.digit)] : ['G', section.letter],
    disabled: null,
    run: done(() => actions.showSection(section.view)),
  }));
  const status = state.status;
  const blocked = repositoryChangeBlocked(state);
  const behind = status?.behind ?? 0;
  const ahead = status?.ahead ?? 0;
  items.push({
    key: 'pull',
    icon: 'pull',
    title: behind > 0 ? `Pull ${plural(behind, 'commit')}` : 'Pull',
    detail: status?.upstream ? `From ${status.upstream}` : 'From the branch’s upstream',
    verb: 'run',
    verbLabel: 'Run',
    disabled: blocked
      ?? (status!.detached || status!.unborn ? 'Check out a branch with commits first'
        : !status!.upstream ? 'This branch has no upstream to pull from'
          : behind === 0 ? 'Nothing to pull. Refresh checks the remote for new commits' : null),
    run: done(actions.pull),
  });
  const publish = state.publishBranch || Boolean(status?.unborn);
  items.push({
    key: 'push',
    icon: 'push',
    title: publish ? 'Publish branch' : ahead > 0 ? `Push ${plural(ahead, 'commit')}` : 'Push',
    detail: publish ? 'Push it and set its upstream' : status?.upstream ? `To ${status.upstream}` : 'To the branch’s upstream',
    verb: 'run',
    verbLabel: 'Run',
    disabled: blocked
      ?? (status!.unborn ? 'Create the first commit before publishing this branch'
        : status!.detached ? 'Check out a branch first'
          : !publish && ahead === 0 ? 'Nothing to push' : null),
    run: done(actions.push),
  });
  items.push({
    key: 'refresh',
    icon: 'refresh',
    title: 'Refresh',
    detail: 'Check the remote and read the repository again',
    verb: 'run',
    verbLabel: 'Run',
    keys: state.keys.refresh.split('+'),
    disabled: state.busy || state.syncBusy ? 'Wait for the current operation to finish' : null,
    run: done(actions.refresh),
  });
  const unstaged = status?.changes.filter((change) => change.unstaged && !change.conflict).length ?? 0;
  items.push({
    key: 'discard',
    icon: 'discard',
    title: 'Discard unstaged changes…',
    detail: unstaged > 0 ? `Asks before discarding ${plural(unstaged, 'file')}` : 'Asks before discarding anything',
    verb: 'ask',
    verbLabel: 'Run…',
    disabled: blocked ?? (unstaged === 0 ? 'There are no unstaged changes' : null),
    run: done(actions.discardUnstaged),
  });
  if (state.github) {
    items.push({
      key: 'create-pull-request',
      icon: 'pull-request',
      title: 'Create pull request…',
      detail: 'Opens the form',
      verb: 'open',
      verbLabel: 'Open',
      disabled: state.createPullRequestBlocked,
      run: done(actions.createPullRequest),
    });
  }
  items.push(
    { key: 'add-repository', icon: 'folder', title: 'Open repository…', detail: 'Choose a folder', verb: 'open', verbLabel: 'Open', keys: state.keys.openRepository.split('+'), disabled: null, run: done(actions.addRepository) },
    { key: 'settings', icon: 'settings', title: 'Settings', detail: '', verb: 'open', verbLabel: 'Open', disabled: null, run: done(() => actions.openSettings('general')) },
  );
  // Phones have no Shortcuts settings.
  if (!state.mobile) items.push({ key: 'shortcuts', icon: 'keyboard', title: 'Keyboard shortcuts', detail: 'Settings → Shortcuts', verb: 'open', verbLabel: 'Open', keys: ['?'], disabled: null, run: done(() => actions.openSettings('shortcuts')) });
  if (state.github) items.push({ key: 'github', icon: 'external', title: 'Open repository on GitHub', detail: state.github.nameWithOwner, verb: 'out', verbLabel: 'Open in GitHub', disabled: null, run: done(actions.openOnGitHub) });
  return items;
}

/** The branches as the branch menu offers them: the current one first, then local ones by date, then remote ones. */
export function branchItems(state: PaletteState, actions: PaletteActions): PaletteItem[] {
  const blocked = repositoryChangeBlocked(state);
  const time = (branch: BranchInfo) => { const value = branch.date ? Date.parse(branch.date) : Number.NaN; return Number.isNaN(value) ? -Infinity : value; };
  const local = state.branches.filter((branch) => !branch.remote).sort((a, b) => Number(b.current) - Number(a.current) || time(b) - time(a));
  const remote = state.branches.filter((branch) => branch.remote && !branch.fullName.endsWith('/HEAD'));
  return [...local, ...remote].map((branch): PaletteItem => {
    const base = { key: `branch:${branch.fullName}`, icon: 'branch' as const, title: branch.name };
    const age = branch.date ? formatTimeAgo(branch.date) : null;
    if (branch.current) {
      return { ...base, detail: ['Current branch', aheadBehind(branch)].filter(Boolean).join(' · '), verb: 'current', verbLabel: 'Show in History', disabled: null, run: done(() => actions.showSection('history')) };
    }
    const elsewhere = !branch.remote && branch.worktreePath ? state.worktrees.find((worktree) => samePath(worktree.path, branch.worktreePath!)) : undefined;
    if (!branch.remote && branch.worktreePath) {
      const folder = branch.worktreePath.split(/[\\/]/).pop() ?? branch.worktreePath;
      const openable = elsewhere && !elsewhere.prunable && !elsewhere.bare;
      // A branch checked out in another worktree opens there; switching to it here is what Git refuses.
      return {
        ...base, icon: 'worktree', detail: `In the worktree ${folder}`, verb: 'open', verbLabel: 'Open worktree',
        disabled: openable ? (state.busy ? 'Wait for the current operation to finish' : null) : `In use in ${folder}`,
        run: done(() => actions.openWorktree(elsewhere!.path)),
      };
    }
    return {
      ...base,
      detail: [branch.remote ? 'Remote branch' : null, age ? `Last commit ${age}` : null, branch.subject || null].filter(Boolean).join(' · '),
      verb: 'run', verbLabel: 'Switch', disabled: blocked, run: done(() => actions.switchBranch(branch.fullName)),
    };
  });
}

function aheadBehind(branch: BranchInfo): string | null {
  const parts = [branch.ahead > 0 ? `${branch.ahead} to push` : null, branch.behind > 0 ? `${branch.behind} to pull` : null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

export function commitItem(commit: CommitInfo, actions: PaletteActions): PaletteItem {
  return {
    key: `commit:${commit.oid}`, icon: 'commit', title: commit.subject || '(no subject)',
    detail: [commit.shortOid, commit.author, commit.date ? formatTimeAgo(commit.date) : null].filter(Boolean).join(' · '),
    verb: 'open', verbLabel: 'Open', disabled: null, run: done(() => actions.openCommit(commit.oid, commit.subject)),
  };
}

export function pullRequestItem(pull: PullRequestSummary, actions: PaletteActions): PaletteItem {
  const state = pull.state === 'MERGED' ? 'merged' : pull.state === 'CLOSED' ? 'closed' : pull.isDraft ? 'draft' : 'open';
  return {
    key: `pull:${pull.number}`, icon: pull.state === 'MERGED' ? 'merged' : 'pull-request', title: `#${pull.number} ${pull.title || '(no title)'}`,
    detail: [pull.headRefName, state, pull.author].filter(Boolean).join(' · '),
    verb: 'open', verbLabel: 'Open', disabled: null, run: done(() => actions.openPullRequest(pull.number)),
  };
}

export function runItem(run: ActionRunSummary, actions: PaletteActions, now = Date.now()): PaletteItem {
  const tone = actionTone(run.status, run.conclusion);
  return {
    key: `run:${run.id}`,
    icon: tone === 'success' ? 'run-success' : tone === 'failure' ? 'run-failure' : 'run-pending',
    title: `${run.workflowName} #${run.number} · ${run.title || `Run ${run.number}`}`,
    detail: [run.branch, `${actionStatusLabel(run.status, run.conclusion).toLowerCase()} ${formatTimeAgo(run.createdAt, now)}`].filter(Boolean).join(' · '),
    verb: 'open', verbLabel: 'Open', disabled: null, run: done(() => actions.openRun(run.id)),
  };
}

export function repositoryItems(state: PaletteState, actions: PaletteActions): PaletteItem[] {
  return [...state.repositories]
    .sort((a, b) => Number(b.id === state.repositoryId) - Number(a.id === state.repositoryId) || b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .map((repository: RecentRepository): PaletteItem => {
      const current = repository.id === state.repositoryId;
      const missing = state.unavailableRepositories.has(repository.id);
      return {
        key: `repository:${repository.id}`, icon: 'folder', title: repository.name,
        detail: current ? `Current · ${repository.path}` : missing ? 'Its folder is missing · Locate it' : repository.path,
        verb: current ? 'current' : 'open', verbLabel: current ? 'Current' : missing ? 'Locate' : 'Open',
        disabled: null,
        // The palette can't be a way around a repository's own switch: the same choice as its menu.
        run: done(() => { if (!current) actions.openRepository(repository.id); }),
      };
    });
}

/** How a place visited earlier is named, from what the app has listed. */
export interface PlaceNames {
  pull(number: number): PullRequestSummary | undefined;
  run(runId: number): ActionRunSummary | null;
}

export function placeItem(location: NavigationLocation, names: PlaceNames, actions: PaletteActions): PaletteItem {
  const section = sectionLabel(location.view);
  const selection = location.selection;
  const base = { key: `place:${placeKey(location)}`, verb: 'open' as const, verbLabel: 'Open', disabled: null, run: done(() => actions.openPlace(location)) };
  if (!selection) return { ...base, icon: SECTIONS.find((item) => item.view === location.view)!.icon, title: section, detail: 'Section' };
  const name = (path: string) => path.split('/').pop() ?? path;
  switch (selection.type) {
    case 'file': return { ...base, icon: 'file', path: selection.path, title: `${name(selection.path)}${location.line ? `:${location.line}` : ''}`, detail: parentDirectory(selection.path) || 'Repository root' };
    case 'diff': return { ...base, icon: 'changes', title: name(selection.path), detail: `${selection.kind === 'staged' ? 'Staged' : 'Unstaged'} change · ${parentDirectory(selection.path) || 'Repository root'}` };
    case 'conflict': return { ...base, icon: 'changes', title: name(selection.path), detail: 'Conflict' };
    case 'commit': return { ...base, icon: 'commit', title: selection.subject || selection.oid.slice(0, 7), detail: `Commit ${selection.oid.slice(0, 7)}` };
    case 'commit-file': return { ...base, icon: 'commit', title: name(selection.path), detail: `In commit ${selection.oid.slice(0, 7)}` };
    case 'pull-request': {
      const pull = names.pull(selection.number);
      return { ...base, icon: 'pull-request', title: `#${selection.number}${pull ? ` ${pull.title}` : ''}`, detail: 'Pull request' };
    }
    case 'release': return { ...base, icon: 'release', title: selection.tag, detail: 'Release' };
    case 'workflow-run': {
      const run = names.run(selection.runId);
      return { ...base, icon: 'run-pending', title: run ? `${run.workflowName} #${run.number}` : `Run ${selection.runId}`, detail: 'Workflow run' };
    }
  }
}

function placeKey(location: NavigationLocation): string {
  const selection = location.selection;
  if (!selection) return location.view;
  switch (selection.type) {
    case 'file': return `file:${selection.path}:${location.line ?? ''}`;
    case 'diff': return `diff:${selection.kind}:${selection.path}`;
    case 'conflict': return `conflict:${selection.path}`;
    case 'commit': return `commit:${selection.oid}`;
    case 'commit-file': return `commit-file:${selection.oid}:${selection.path}`;
    case 'pull-request': return `pull:${selection.number}`;
    case 'release': return `release:${selection.tag}`;
    case 'workflow-run': return `run:${selection.runId}:${selection.jobId ?? ''}`;
  }
}

/** The text a place is found by. */
export function placeText(item: PaletteItem): string[] {
  return [item.title, item.detail];
}
