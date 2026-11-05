import { z } from 'zod';
import type { ActionRunJob, ActionRunPage, ActionRunSummary } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';


function invalid(operation: string): GhOperationError {
  return new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
}

function parseJson(raw: string, operation: string): unknown {
  try { return JSON.parse(raw); } catch { throw invalid(operation); }
}

/** GitHub writes "" for a conclusion that isn't known yet, and the year 1 for a time that hasn't happened. */
const optionalText = z.string().nullish().transform((value) => value || null);
const optionalTime = optionalText.transform((value) => value && !value.startsWith('0001-') ? value : null);

const actorSchema = z.object({ login: z.string(), avatar_url: z.string().nullish() });

const restRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().nullish(),
  display_title: z.string().nullish(),
  run_number: z.number().int().nonnegative(),
  run_attempt: z.number().int().nonnegative().nullish(),
  workflow_id: z.number().int().nonnegative(),
  status: z.string().nullish(),
  conclusion: optionalText,
  event: z.string(),
  head_branch: optionalText,
  head_sha: z.string(),
  html_url: z.string(),
  path: optionalText,
  created_at: z.string(),
  run_started_at: optionalTime,
  updated_at: z.string(),
  actor: actorSchema.nullish(),
  triggering_actor: actorSchema.nullish(),
  pull_requests: z.array(z.object({ number: z.number().int().positive() })).nullish(),
});

/** The REST view of a run, which also names its workflow file. */
export function parseActionRun(raw: string): ActionRunSummary & { path: string | null } {
  const operation = 'gh-action-run-view';
  const parsed = restRunSchema.safeParse(parseJson(raw, operation));
  if (!parsed.success) throw invalid(operation);
  return runFromRest(parsed.data);
}

/** One page of a repository's or a workflow's runs, newest first. */
export function parseActionRunPage(raw: string, page: number, perPage: number): ActionRunPage {
  const operation = 'gh-action-run-list';
  const parsed = z.object({ total_count: z.number().int().nonnegative(), workflow_runs: z.array(restRunSchema) }).safeParse(parseJson(raw, operation));
  if (!parsed.success) throw invalid(operation);
  return {
    runs: parsed.data.workflow_runs.map((run) => { const { path: _path, ...summary } = runFromRest(run); return summary; }),
    hasMore: parsed.data.workflow_runs.length === perPage && page * perPage < parsed.data.total_count,
  };
}

function runFromRest(run: z.infer<typeof restRunSchema>): ActionRunSummary & { path: string | null } {
  const actor = run.triggering_actor ?? run.actor ?? null;
  return {
    id: run.id,
    number: run.run_number,
    attempt: run.run_attempt || 1,
    title: run.display_title || run.name || `Run ${run.run_number}`,
    workflowId: run.workflow_id,
    workflowName: run.name || 'Workflow',
    status: run.status || 'unknown',
    conclusion: run.conclusion,
    event: run.event,
    branch: run.head_branch,
    headSha: run.head_sha,
    url: run.html_url,
    createdAt: run.created_at,
    startedAt: run.run_started_at,
    updatedAt: run.updated_at,
    // A reusable workflow's path can carry the ref it was called at.
    path: run.path ? run.path.replace(/@.*$/, '') : null,
    actor: actor ? { login: actor.login, avatarUrl: actor.avatar_url ?? null } : null,
    // A pull_request run lists the pull requests of its head branch; GitHub leaves the list empty for a fork's.
    pullRequestNumber: run.event.startsWith('pull_request') ? run.pull_requests?.[0]?.number ?? null : null,
  };
}

const restJobsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  jobs: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string(),
    status: z.string(),
    conclusion: optionalText,
    started_at: optionalTime,
    completed_at: optionalTime,
    html_url: optionalText,
    runner_name: optionalText,
    steps: z.array(z.object({
      number: z.number().int(),
      name: z.string(),
      status: z.string(),
      conclusion: optionalText,
      started_at: optionalTime,
      completed_at: optionalTime,
    })).nullish(),
  })),
});

export function parseActionRunJobs(raw: string): { jobs: ActionRunJob[]; total: number } {
  const operation = 'gh-action-run-view';
  const parsed = restJobsSchema.safeParse(parseJson(raw, operation));
  if (!parsed.success) throw invalid(operation);
  return {
    total: parsed.data.total_count,
    jobs: parsed.data.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      url: job.html_url,
      runnerName: job.runner_name,
      steps: (job.steps ?? []).map((step) => ({
        number: step.number,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
        startedAt: step.started_at,
        completedAt: step.completed_at,
      })),
    })),
  };
}

/** The base64 file body of a `contents` API response. */
export function parseContentsFile(raw: string): string | null {
  const parsed = z.object({ content: z.string(), encoding: z.string() }).safeParse(parseJson(raw, 'gh-action-run-view'));
  if (!parsed.success || parsed.data.encoding !== 'base64') return null;
  return Buffer.from(parsed.data.content.replace(/\s+/g, ''), 'base64').toString('utf8');
}

export function parseBranchNames(raw: string): string[] {
  const parsed = z.array(z.object({ name: z.string() })).safeParse(parseJson(raw, 'gh-workflow-runnable'));
  if (!parsed.success) throw invalid('gh-workflow-runnable');
  return parsed.data.map((branch) => branch.name);
}
