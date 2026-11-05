import type { ActionRunDetails, ActionRunGraphNode, ActionRunJob, ActionRunPage, ActionRunSummary, RunnableWorkflowList, WorkflowTriggers } from '../../src/shared/contracts';
import { sampleDate } from './model.ts';
import { demoPulls } from './pulls.ts';

/**
 * Sample GitHub Actions runs for the demo. They follow the sample's workflow files in
 * `.github/workflows/` and its pull requests: each PR's run has the jobs and results of its checks.
 */
const sampleTime = Date.parse(sampleDate);
const minutesAgo = (minutes: number) => new Date(sampleTime - minutes * 60_000).toISOString();
// The running run started a few minutes before the page opened, so its duration counts up from there.
const liveTime = Date.now();
const liveMinutesAgo = (minutes: number) => new Date(liveTime - minutes * 60_000).toISOString();
// The sample repository's published commit, so a run's commit opens in OpenTig too.
const mainSha = 'a'.repeat(40);

const triggers: Record<string, WorkflowTriggers> = {
  '.github/workflows/prepare-release.yml': { events: ['workflow_dispatch'], inputs: [
    { name: 'version', description: 'Version without the leading v, such as 0.5.0', required: true, default: null, type: 'string', options: [] },
    { name: 'prerelease', description: 'Mark the draft as a pre-release', required: false, default: 'false', type: 'boolean', options: [] },
  ] },
  '.github/workflows/ci.yml': { events: ['pull_request', 'push'], inputs: null },
  '.github/workflows/nightly.yml': { events: ['schedule', 'workflow_dispatch'], inputs: [
    { name: 'suite', description: 'Which tests to run', required: false, default: 'full', type: 'choice', options: ['full', 'smoke'] },
  ] },
};

const workflows = [
  { id: 1, name: 'Prepare release', path: '.github/workflows/prepare-release.yml' },
  { id: 2, name: 'CI', path: '.github/workflows/ci.yml' },
  { id: 3, name: 'Nightly checks', path: '.github/workflows/nightly.yml' },
];

// GitHub's branches: the default one, then the open pull requests' branches.
const branches = ['main', ...demoPulls.list(['OPEN']).map((pr) => pr.headRefName).sort()];

const runnable: RunnableWorkflowList = {
  defaultBranch: 'main',
  viewerCanWrite: true,
  branches,
  workflows: workflows.map((workflow) => ({ ...workflow, triggers: triggers[workflow.path]! })),
};

type Result = 'success' | 'failure' | 'skipped' | null;
type SampleRun = {
  summary: ActionRunSummary;
  jobs: ActionRunJob[];
  graph: ActionRunGraphNode[];
};

/** A job's steps as GitHub names them: setup, then each step of the workflow file, then cleanup. */
function job(id: number, name: string, result: Result, started: string | null, finished: string | null, steps: [string, Result][]): ActionRunJob {
  const running = steps.findIndex(([, value]) => value === null);
  return {
    id, name, status: result ? 'completed' : started ? 'in_progress' : 'queued', conclusion: result,
    startedAt: result === 'skipped' ? null : started, completedAt: result ? finished : null, url: null, runnerName: started && result !== 'skipped' ? 'GitHub Actions 7' : null,
    steps: result === 'skipped' ? [] : steps.map(([stepName, stepResult], index) => ({
      number: index + 1, name: stepName,
      status: stepResult ? 'completed' : index === running && started ? 'in_progress' : 'queued',
      conclusion: stepResult,
      startedAt: stepResult || (index === running && started) ? started : null,
      completedAt: stepResult ? finished ?? started : null,
    })),
  };
}

const node = ['Run actions/checkout@v4', 'Run actions/setup-node@v4', 'Run npm ci'];
/** Steps of a CI job: setup succeeds, and its last step has the job's result, or is still running. */
const ciSteps = (last: string, result: Result): [string, Result][] =>
  [['Set up job', 'success'], ...node.map((step): [string, Result] => [step, 'success']), [last, result], ...(result ? [['Complete job', 'success'] as [string, Result]] : [])];

/** `.github/workflows/ci.yml`: test and lint side by side; preview needs test and only runs on pushes to main. */
function ciRun(run: ActionRunSummary, at: (minutes: number) => string, results: { test: Result; lint: Result; preview: Result | 'waiting' }): SampleRun {
  const ids = run.id * 10;
  const jobs = [
    job(ids + 1, 'test', results.test, at(4), results.test ? at(1) : null, ciSteps('Run npm test', results.test)),
    job(ids + 2, 'lint', results.lint, at(4), results.lint ? at(2.5) : null, ciSteps('Run npm run lint', results.lint)),
    ...(results.preview === 'waiting' ? [] : [job(ids + 3, 'preview', results.preview, at(1), at(0.5), [
      ['Set up job', 'success'], ['Run actions/checkout@v4', 'success'], ['Run actions/upload-artifact@v4', 'success'], ['Complete job', 'success'],
    ])]),
  ];
  return {
    summary: run, jobs,
    graph: [
      { id: 'test', name: 'test', needs: [], jobIds: [ids + 1] },
      { id: 'lint', name: 'lint', needs: [], jobIds: [ids + 2] },
      { id: 'preview', name: 'preview', needs: ['test'], jobIds: results.preview === 'waiting' ? [] : [ids + 3] },
    ],
  };
}

/** A workflow with one job, such as `prepare` in prepare-release.yml or `checks` in nightly.yml. */
function singleJobRun(run: ActionRunSummary, name: string, steps: string[], minutes: number): SampleRun {
  const started = run.startedAt!;
  const finished = new Date(Date.parse(started) + minutes * 60_000).toISOString();
  const failing = run.conclusion === 'failure';
  const id = run.id * 10 + 1;
  return {
    summary: run,
    jobs: [job(id, name, failing ? 'failure' : 'success', started, finished, [
      ['Set up job', 'success'],
      ...steps.map((step, index): [string, Result] => [step, failing && index === steps.length - 1 ? 'failure' : 'success']),
      ['Complete job', 'success'],
    ])],
    graph: [{ id: name, name, needs: [], jobIds: [id] }],
  };
}

function summary(input: { id: number; workflowId: number; title: string; conclusion: Result; createdAt: string; updatedAt: string; event: string; branch: string; login?: string; pullRequestNumber?: number }): ActionRunSummary {
  const workflow = workflows.find((item) => item.id === input.workflowId)!;
  const pull = input.pullRequestNumber ? demoPulls.get(input.pullRequestNumber) : null;
  return {
    id: input.id, number: input.id, attempt: 1, title: input.title, workflowId: workflow.id, workflowName: workflow.name,
    status: input.conclusion ? 'completed' : 'in_progress', conclusion: input.conclusion, event: input.event, branch: input.branch,
    headSha: pull?.headRefOid ?? mainSha, url: '', createdAt: input.createdAt, startedAt: input.createdAt, updatedAt: input.updatedAt,
    actor: { login: input.login ?? 'opentig-demo', avatarUrl: null }, pullRequestNumber: input.pullRequestNumber ?? null,
  };
}

/** A CI run for a sample pull request, on its branch and head commit. */
function pullRequestRun(id: number, number: number, conclusion: Result, at: (minutes: number) => string) {
  const pull = demoPulls.get(number);
  return summary({ id, workflowId: 2, title: pull.title, conclusion, createdAt: at(4), updatedAt: at(conclusion ? 0.5 : 0), event: 'pull_request', branch: pull.headRefName, pullRequestNumber: number });
}
const at = (offset: number) => (minutes: number) => minutesAgo(offset + minutes);

const releaseSteps = ['Check out', 'Install dependencies', 'Update the version', 'Create the draft release'];
const samples: SampleRun[] = [
  // #25's checks are still running: test is pending and preview waits for it.
  ciRun(pullRequestRun(44, 25, null, liveMinutesAgo), liveMinutesAgo, { test: null, lint: 'success', preview: 'waiting' }),
  singleJobRun(summary({ id: 30, workflowId: 1, title: 'Prepare release', conclusion: 'success', createdAt: minutesAgo(50), updatedAt: minutesAgo(48), event: 'workflow_dispatch', branch: 'main' }), 'prepare', releaseSteps, 2),
  // #21's checks passed; preview is skipped on pull requests.
  ciRun(pullRequestRun(43, 21, 'success', at(90)), at(90), { test: 'success', lint: 'success', preview: 'skipped' }),
  // The push to main that merged #19.
  ciRun(summary({ id: 42, workflowId: 2, title: 'Document the local test command (#19)', conclusion: 'success', createdAt: at(180)(4), updatedAt: at(180)(0.5), event: 'push', branch: 'main' }), at(180), { test: 'success', lint: 'success', preview: 'success' }),
  singleJobRun(summary({ id: 12, workflowId: 3, title: 'Nightly checks', conclusion: 'success', createdAt: minutesAgo(720), updatedAt: minutesAgo(711), event: 'schedule', branch: 'main', login: 'github-actions[bot]' }), 'checks', ['Check out', 'Install dependencies', 'Run the full suite'], 9),
  // #24's test fails, so preview never runs.
  ciRun(pullRequestRun(41, 24, 'failure', at(1500)), at(1500), { test: 'failure', lint: 'success', preview: 'skipped' }),
  singleJobRun(summary({ id: 29, workflowId: 1, title: 'Prepare release', conclusion: 'failure', createdAt: minutesAgo(2900), updatedAt: minutesAgo(2899), event: 'workflow_dispatch', branch: 'main' }), 'prepare', releaseSteps, 1),
];

export const demoActions = {
  runnable() { return structuredClone(runnable); },
  triggers(path: string): WorkflowTriggers | null { return structuredClone(triggers[path] ?? null); },
  list(workflowId: number | null): ActionRunPage {
    const runs = samples.map((sample) => sample.summary).filter((run) => workflowId === null || run.workflowId === workflowId);
    return { runs: structuredClone(runs), hasMore: false };
  },
  get(runId: number): ActionRunDetails {
    const sample = samples.find((item) => item.summary.id === runId);
    if (!sample) throw new Error('Choose a run from the sample repository.');
    const path = workflows.find((workflow) => workflow.id === sample.summary.workflowId)?.path ?? null;
    return structuredClone({ ...sample.summary, path, jobs: sample.jobs, jobsTruncated: false, graph: sample.graph, graphSource: 'workflow' as const });
  },
};
