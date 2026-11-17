import { parentDirectory } from '@/features/files/file-tree';
import type { NavigationLocation, SidebarView } from './location';
import type { TrailStep } from './trail';

export type StepIcon = 'changes' | 'files' | 'history' | 'github' | 'search' | 'file' | 'commit' | 'pull-request' | 'release' | 'run';

/** How a step reads in the lists of Back and Forward: what it shows, and where. */
export interface StepName {
  icon: StepIcon;
  /** The pull request, commit, run or file, or the section when nothing is open in it. */
  title: string;
  /** The repository when it is not the one open, the section, and what the step shows of its item. */
  detail: string;
}

/** What the app already knows that names a step better than its location alone. */
export interface StepNameSources {
  /** The repository open now: a step in another one says which. */
  repositoryId: string | null;
  repositoryName(repositoryId: string): string | null;
  pullTitle(repositoryId: string, number: number): string | null;
  runTitle(repositoryId: string, runId: number): string | null;
}

const SECTION_LABELS: Readonly<Record<SidebarView, string>> = { changes: 'Changes', files: 'Files', history: 'History', prs: 'GitHub', search: 'Search' };
const PULL_TABS: Readonly<Record<string, string>> = { summary: 'Summary', comments: 'Comments', checks: 'Checks', timeline: 'Timeline', diff: 'Code' };

const fileName = (path: string) => path.split('/').pop() ?? path;
const folderOf = (path: string) => parentDirectory(path) || 'Repository root';

export function nameStep(step: Pick<TrailStep, 'location' | 'memory'>, sources: StepNameSources): StepName {
  const { location } = step;
  const where = (...parts: Array<string | null>) => [
    location.repositoryId !== sources.repositoryId ? sources.repositoryName(location.repositoryId) ?? 'Another repository' : null,
    SECTION_LABELS[location.view],
    ...parts,
  ].filter(Boolean).join(' · ');
  const selection = location.selection;
  if (!selection) {
    if (location.view === 'history' && location.fileHistory) return { icon: 'history', title: `History of ${fileName(location.fileHistory.path)}`, detail: where(folderOf(location.fileHistory.path)) };
    return { icon: sectionIcon(location.view), title: SECTION_LABELS[location.view], detail: where() };
  }
  switch (selection.type) {
    case 'file': return { icon: 'file', title: `${fileName(selection.path)}${location.line ? `:${location.line}` : ''}`, detail: where(folderOf(selection.path)) };
    case 'diff': return { icon: 'changes', title: fileName(selection.path), detail: where(selection.kind === 'staged' ? 'Staged' : 'Unstaged') };
    case 'conflict': return { icon: 'changes', title: fileName(selection.path), detail: where('Conflict') };
    case 'commit': return { icon: 'commit', title: selection.subject && selection.subject !== selection.oid.slice(0, 8) ? selection.subject : `Commit ${selection.oid.slice(0, 7)}`, detail: where(`Commit ${selection.oid.slice(0, 7)}`) };
    case 'commit-file': return { icon: 'file', title: fileName(selection.path), detail: where(`In commit ${selection.oid.slice(0, 7)}`) };
    case 'pull-request': {
      const title = sources.pullTitle(location.repositoryId, selection.number);
      const tab = pullTab(step, location);
      return { icon: 'pull-request', title: `#${selection.number}${title ? ` ${title}` : ''}`, detail: where(tab ? `Pull request · ${tab}` : 'Pull request') };
    }
    case 'release': return { icon: 'release', title: selection.tag, detail: where('Release') };
    case 'workflow-run': return { icon: 'run', title: sources.runTitle(location.repositoryId, selection.runId) ?? `Run ${selection.runId}`, detail: where(selection.jobId ? 'Workflow run · One job' : 'Workflow run') };
  }
}

/** The tab the step's pull request was left on, which Back opens it on. */
function pullTab(step: Pick<TrailStep, 'memory'>, location: NavigationLocation): string | null {
  if (location.selection?.type !== 'pull-request') return null;
  const key = `${location.repositoryId}:pull:${location.selection.number}`;
  const tab = step.memory.viewer.tabs?.find(([documentKey]) => documentKey === key)?.[1];
  return tab ? PULL_TABS[tab] ?? null : null;
}

function sectionIcon(view: SidebarView): StepIcon {
  return view === 'prs' ? 'github' : view;
}
