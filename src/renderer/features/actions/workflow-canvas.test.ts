import { describe, expect, it } from 'vitest';
import type { ActionRunGraphNode, ActionRunJob, ActionRunSummary } from '../../../shared/contracts';
import { ACTIVE_RUNS_REFRESH_MS, IDLE_RUNS_REFRESH_MS, actionStatusLabel, actionTone, combinedTone, findStartedRun, formatDuration, jobLabel, runListRefreshInterval, runSentence } from './action-status';
import { JOB_ROW_HEIGHT, MAX_VISIBLE_JOBS, NODE_HEADER_HEIGHT, NODE_WIDTH, layoutWorkflowGraph } from './workflow-canvas-layout';

const node = (id: string, needs: string[] = [], jobIds: number[] = [1]): ActionRunGraphNode => ({ id, name: id, needs, jobIds });
const job = (id: number, status: string, conclusion: string | null): ActionRunJob => ({
  id, name: `job ${id}`, status, conclusion, startedAt: null, completedAt: null, url: null, runnerName: null, steps: [],
});

describe('workflow canvas layout', () => {
  it('puts each job one column after the furthest job it needs', () => {
    const layout = layoutWorkflowGraph([node('changes'), node('build', ['changes']), node('test', ['build']), node('lint', ['changes']), node('deploy', ['test', 'lint'])]);
    const column = Object.fromEntries(layout.nodes.map((item) => [item.node.id, item.column]));
    expect(column).toEqual({ changes: 0, build: 1, lint: 1, test: 2, deploy: 3 });
    expect(layout.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['changes->build', 'changes->lint', 'build->test', 'test->deploy', 'lint->deploy']);
    const changes = layout.nodes.find((item) => item.node.id === 'changes')!;
    const build = layout.nodes.find((item) => item.node.id === 'build')!;
    expect(build.x).toBeGreaterThan(changes.x + NODE_WIDTH);
    expect(layout.edges[0]!.path).toMatch(new RegExp(`^M ${changes.x + NODE_WIDTH} `));
  });

  it('sizes a matrix by its jobs and folds a long one behind "more"', () => {
    const many = Array.from({ length: 9 }, (_, index) => index + 1);
    const [single, matrix] = layoutWorkflowGraph([node('one'), node('matrix', [], many)]).nodes;
    expect(single!.height).toBe(NODE_HEADER_HEIGHT);
    expect(matrix!.visibleJobIds).toHaveLength(MAX_VISIBLE_JOBS - 1);
    expect(matrix!.hidden).toBe(9 - (MAX_VISIBLE_JOBS - 1));
    const expanded = layoutWorkflowGraph([node('matrix', [], many)], new Set(['matrix'])).nodes[0]!;
    expect(expanded.visibleJobIds).toEqual(many);
    expect(expanded.height).toBeGreaterThan(matrix!.height + 3 * JOB_ROW_HEIGHT);
  });

  it('orders a column by what its jobs need, and survives a cycle', () => {
    const layout = layoutWorkflowGraph([node('a'), node('b'), node('after-b', ['b']), node('after-a', ['a'])]);
    const second = layout.nodes.filter((item) => item.column === 1).sort((left, right) => left.y - right.y).map((item) => item.node.id);
    expect(second).toEqual(['after-a', 'after-b']);
    expect(layoutWorkflowGraph([node('x', ['y']), node('y', ['x'])]).nodes).toHaveLength(2);
  });
});

describe('action status', () => {
  it('names and colours GitHub states', () => {
    expect(actionTone('completed', 'success')).toBe('success');
    expect(actionTone('completed', 'timed_out')).toBe('failure');
    expect(actionTone('in_progress', null)).toBe('running');
    expect(actionTone('waiting', null)).toBe('queued');
    expect(actionStatusLabel('completed', 'startup_failure')).toBe('Failed to start');
    expect(combinedTone(['success', 'failure', 'running'])).toBe('failure');
    expect(combinedTone(['skipped', 'skipped'])).toBe('skipped');
    expect(combinedTone(['success', 'skipped'])).toBe('success');
  });

  it('sums a run up in one sentence', () => {
    expect(runSentence('in_progress', null, [job(1, 'completed', 'success'), job(2, 'in_progress', null), job(3, 'completed', 'failure')])).toBe('In progress · 2 of 3 jobs done · 1 failed');
    expect(runSentence('completed', 'failure', [job(1, 'completed', 'failure'), job(2, 'completed', 'success')])).toBe('Failed · 1 job failed');
    expect(runSentence('completed', 'success', [job(1, 'completed', 'success')])).toBe('Succeeded · 1 job');
  });

  it('formats durations and matrix labels', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(185_000)).toBe('3m 05s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
    expect(jobLabel('validate (ubuntu-24.04)', 'validate')).toBe('ubuntu-24.04');
    expect(jobLabel('deploy / publish', 'deploy')).toBe('publish');
    expect(jobLabel('other', 'validate')).toBe('other');
  });
});

describe('following new runs', () => {
  const run = (id: number, overrides: Partial<ActionRunSummary> = {}): ActionRunSummary => ({
    id, number: id, attempt: 1, title: `run ${id}`, workflowId: 7, workflowName: 'Deploy website', status: 'queued', conclusion: null,
    event: 'workflow_dispatch', branch: 'main', headSha: 'a'.repeat(40), url: '', createdAt: '2026-11-05T15:00:10Z', startedAt: null, updatedAt: '2026-11-05T15:00:10Z',
    ...overrides,
  });

  it('keeps checking for runs started elsewhere, faster while one is going', () => {
    expect(runListRefreshInterval(undefined)).toBe(IDLE_RUNS_REFRESH_MS);
    expect(runListRefreshInterval([{ status: 'completed' }])).toBe(IDLE_RUNS_REFRESH_MS);
    expect(runListRefreshInterval([{ status: 'completed' }, { status: 'queued' }])).toBe(ACTIVE_RUNS_REFRESH_MS);
  });

  it('recognises the run of a workflow OpenTig just started', () => {
    const started = { workflowId: 7, requestedAt: Date.parse('2026-11-05T15:00:00Z'), knownIds: new Set([1]) };
    expect(findStartedRun([run(1), run(2, { workflowId: 8 }), run(3, { event: 'push' }), run(4, { createdAt: '2026-11-05T14:50:00Z' })], started)).toBeNull();
    expect(findStartedRun([run(5), run(1)], started)?.id).toBe(5);
  });
});
