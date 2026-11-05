import type { ActionRunDetails, ActionRunJob, ActionRunPage, ActionRunSummary, RunnableWorkflowList, WorkflowTriggers } from '../../src/shared/contracts';

/** Sample GitHub Actions runs for the demo, ending a little before it opens. */
const minutesAgo = (minutes: number) => new Date(Date.UTC(2026, 0, 15, 12, 0) - minutes * 60_000).toISOString();
// The sample repository's published commit, so a run's commit opens in OpenTig too.
const sha = 'a'.repeat(40);

const triggers: Record<string, WorkflowTriggers> = {
  '.github/workflows/prepare-release.yml': { events: ['workflow_dispatch'], inputs: [
    { name: 'version', description: 'Version without the leading v, such as 0.5.0', required: true, default: null, type: 'string', options: [] },
    { name: 'prerelease', description: null, required: false, default: 'false', type: 'boolean', options: [] },
  ] },
  '.github/workflows/ci.yml': { events: ['push', 'pull_request'], inputs: null },
  '.github/workflows/nightly.yml': { events: ['schedule', 'workflow_dispatch'], inputs: [
    { name: 'suite', description: null, required: false, default: 'full', type: 'choice', options: ['full', 'smoke'] },
  ] },
};

const runnable: RunnableWorkflowList = {
  defaultBranch: 'main',
  viewerCanWrite: true,
  branches: ['main', 'release-board'],
  workflows: [
    { id: 1, name: 'Prepare release', path: '.github/workflows/prepare-release.yml', triggers: triggers['.github/workflows/prepare-release.yml']! },
    { id: 2, name: 'CI', path: '.github/workflows/ci.yml', triggers: triggers['.github/workflows/ci.yml']! },
    { id: 3, name: 'Nightly checks', path: '.github/workflows/nightly.yml', triggers: triggers['.github/workflows/nightly.yml']! },
  ],
};

function summary(id: number, workflowId: number, workflowName: string, title: string, conclusion: string | null, started: number, minutes: number, event = 'push', branch = 'main', login = 'opentig-demo', pullRequestNumber: number | null = null): ActionRunSummary {
  return {
    actor: { login, avatarUrl: null }, pullRequestNumber,
    id, number: id, attempt: 1, title, workflowId, workflowName, status: conclusion ? 'completed' : 'in_progress', conclusion, event, branch, headSha: sha,
    url: '', createdAt: minutesAgo(started), startedAt: minutesAgo(started), updatedAt: minutesAgo(conclusion ? started - minutes : 0),
  };
}
const runs: ActionRunSummary[] = [
  summary(40, 2, 'CI', 'Hide completed tasks from search results', null, 3, 0),
  summary(30, 1, 'Prepare release', 'Prepare release', 'success', 50, 2, 'workflow_dispatch'),
  summary(39, 2, 'CI', 'Document the local test command', 'success', 95, 6),
  summary(12, 3, 'Nightly checks', 'Nightly checks', 'success', 720, 9, 'schedule', 'main', 'github-actions[bot]'),
  summary(38, 2, 'CI', 'Refine the release board on small screens', 'failure', 1500, 5, 'pull_request', 'release-board', 'opentig-demo', 21),
  summary(29, 1, 'Prepare release', 'Prepare release', 'failure', 2900, 1, 'workflow_dispatch'),
];

function job(id: number, name: string, conclusion: string | null, started: number, minutes: number, steps: [string, string | null][]): ActionRunJob {
  return {
    id, name, status: conclusion ? 'completed' : started ? 'in_progress' : 'queued', conclusion,
    startedAt: started ? minutesAgo(started) : null, completedAt: conclusion ? minutesAgo(started - minutes) : null, url: null, runnerName: started ? 'GitHub Actions 7' : null,
    steps: steps.map(([stepName, stepConclusion], index) => ({
      number: index + 1, name: stepName, status: stepConclusion ? 'completed' : index === steps.findIndex(([, value]) => !value) && started ? 'in_progress' : 'queued',
      conclusion: stepConclusion, startedAt: stepConclusion && started ? minutesAgo(started) : null, completedAt: stepConclusion && started ? minutesAgo(started - 0.4) : null,
    })),
  };
}
const setup: [string, string | null][] = [['Set up job', 'success'], ['Check out', 'success'], ['Install dependencies', 'success']];
const ciJobs = (running: boolean, failing: boolean): ActionRunJob[] => [
  job(1, 'changes', 'success', 3, 0.2, [['Set up job', 'success'], ['Decide what changed', 'success']]),
  job(2, 'test (ubuntu)', running ? null : 'success', 2.8, 2, [...setup, ['Run tests', running ? null : 'success']]),
  job(3, 'test (windows)', running ? null : failing ? 'failure' : 'success', 2.8, 3, [...setup, ['Run tests', running ? null : failing ? 'failure' : 'success']]),
  job(4, 'lint', 'success', 2.8, 1, [...setup, ['Lint', 'success']]),
  ...(running ? [] : [job(5, 'build', failing ? 'skipped' : 'success', 0.6, 1, [...setup, ['Build', failing ? 'skipped' : 'success']])]),
];
const ciGraph = (jobs: ActionRunJob[]) => [
  { id: 'changes', name: 'changes', needs: [], jobIds: [1] },
  { id: 'test', name: 'test', needs: ['changes'], jobIds: [2, 3] },
  { id: 'lint', name: 'lint', needs: ['changes'], jobIds: [4] },
  { id: 'build', name: 'build', needs: ['test', 'lint'], jobIds: jobs.some((item) => item.id === 5) ? [5] : [] },
];

function details(run: ActionRunSummary): ActionRunDetails {
  const base = { ...run, path: runnable.workflows.find((workflow) => workflow.id === run.workflowId)?.path ?? null, jobsTruncated: false, graphSource: 'workflow' as const };
  if (run.workflowId === 2) {
    const jobs = ciJobs(run.status !== 'completed', run.conclusion === 'failure');
    return { ...base, jobs, graph: ciGraph(jobs) };
  }
  const jobs = [job(6, run.workflowName === 'Prepare release' ? 'prepare' : 'checks', run.conclusion, 50, 2, [...setup, ['Run', run.conclusion]])];
  return { ...base, jobs, graph: [{ id: 'main', name: jobs[0]!.name, needs: [], jobIds: [6] }] };
}

export const demoActions = {
  runnable() { return structuredClone(runnable); },
  triggers(path: string): WorkflowTriggers | null { return structuredClone(triggers[path] ?? null); },
  list(workflowId: number | null): ActionRunPage {
    return { runs: structuredClone(runs.filter((run) => workflowId === null || run.workflowId === workflowId)), hasMore: false };
  },
  get(runId: number): ActionRunDetails {
    const run = runs.find((item) => item.id === runId);
    if (!run) throw new Error('Choose a run from the sample repository.');
    return structuredClone(details(run));
  },
};
