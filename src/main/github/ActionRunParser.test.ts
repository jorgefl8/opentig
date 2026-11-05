import { describe, expect, it } from 'vitest';
import { parseActionRun, parseActionRunJobs, parseActionRunList, parseContentsFile } from './ActionRunParser';

describe('action run parser', () => {
  it('reads the run list, leaving unknown conclusions empty', () => {
    const runs = parseActionRunList(JSON.stringify([{
      attempt: 1, conclusion: '', createdAt: '2026-11-05T13:30:53Z', databaseId: 42, displayTitle: 'fix: links', event: 'push',
      headBranch: 'main', headSha: 'a'.repeat(40), number: 340, startedAt: '2026-11-05T13:30:53Z', status: 'in_progress',
      updatedAt: '2026-11-05T13:31:08Z', url: 'https://github.com/o/r/actions/runs/42', workflowDatabaseId: 7, workflowName: 'CI',
    }]));
    expect(runs).toEqual([expect.objectContaining({ id: 42, number: 340, title: 'fix: links', workflowId: 7, workflowName: 'CI', status: 'in_progress', conclusion: null, branch: 'main' })]);
    expect(() => parseActionRunList('{}')).toThrow('unexpected response');
  });

  it('reads a run with its workflow file, and its jobs without placeholder times', () => {
    const run = parseActionRun(JSON.stringify({
      id: 42, name: 'CI', display_title: 'fix: links', run_number: 340, run_attempt: 2, workflow_id: 7, status: 'completed', conclusion: 'failure',
      event: 'pull_request', head_branch: 'feature', head_sha: 'b'.repeat(40), html_url: 'https://github.com/o/r/actions/runs/42',
      path: '.github/workflows/ci.yml@refs/heads/main', created_at: '2026-11-05T13:00:00Z', run_started_at: '2026-11-05T13:00:05Z', updated_at: '2026-11-05T13:05:00Z',
      actor: { login: 'author' }, triggering_actor: { login: 'rerunner' },
    }));
    expect(run).toMatchObject({ id: 42, attempt: 2, path: '.github/workflows/ci.yml', actor: 'rerunner', conclusion: 'failure', workflowName: 'CI' });

    const { jobs, total } = parseActionRunJobs(JSON.stringify({ total_count: 1, jobs: [{
      id: 9, name: 'validate (linux)', status: 'in_progress', conclusion: null, started_at: '2026-11-05T13:00:10Z', completed_at: '0001-01-01T00:00:00Z',
      html_url: 'https://github.com/o/r/actions/runs/42/job/9', runner_name: 'GitHub Actions 2',
      steps: [{ number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', started_at: '2026-11-05T13:00:10Z', completed_at: '2026-11-05T13:00:12Z' }],
    }] }));
    expect(total).toBe(1);
    expect(jobs[0]).toMatchObject({ id: 9, completedAt: null, conclusion: null, steps: [expect.objectContaining({ name: 'Set up job', conclusion: 'success' })] });
  });

  it('decodes a workflow file from the contents API', () => {
    const content = Buffer.from('jobs:\n  build: {}\n').toString('base64');
    expect(parseContentsFile(JSON.stringify({ content: `${content.slice(0, 4)}\n${content.slice(4)}`, encoding: 'base64' }))).toBe('jobs:\n  build: {}\n');
    expect(parseContentsFile(JSON.stringify({ content: '', encoding: 'none' }))).toBeNull();
  });
});
