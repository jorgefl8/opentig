import { describe, expect, it } from 'vitest';
import { parseActionRun, parseActionRunJobs, parseActionRunPage, parseContentsFile } from './ActionRunParser';

describe('action run parser', () => {
  it('reads a page of runs, leaving unknown conclusions empty, and whether more follow', () => {
    const rest = {
      id: 42, name: 'CI', display_title: 'fix: links', run_number: 340, run_attempt: 1, workflow_id: 7, status: 'in_progress', conclusion: null,
      event: 'push', head_branch: 'main', head_sha: 'a'.repeat(40), html_url: 'https://github.com/o/r/actions/runs/42', path: '.github/workflows/ci.yml',
      created_at: '2026-11-05T13:30:53Z', run_started_at: '2026-11-05T13:30:53Z', updated_at: '2026-11-05T13:31:08Z', actor: { login: 'author', avatar_url: 'https://avatars.example/author' },
    };
    const page = parseActionRunPage(JSON.stringify({ total_count: 3, workflow_runs: [rest, { ...rest, id: 43 }] }), 1, 2);
    expect(page.hasMore).toBe(true);
    expect(page.runs[0]).toEqual({
      id: 42, number: 340, attempt: 1, title: 'fix: links', workflowId: 7, workflowName: 'CI', status: 'in_progress', conclusion: null, event: 'push',
      branch: 'main', headSha: 'a'.repeat(40), url: 'https://github.com/o/r/actions/runs/42', createdAt: '2026-11-05T13:30:53Z', startedAt: '2026-11-05T13:30:53Z', updatedAt: '2026-11-05T13:31:08Z',
      actor: { login: 'author', avatarUrl: 'https://avatars.example/author' }, pullRequestNumber: null,
    });
    expect(parseActionRunPage(JSON.stringify({ total_count: 3, workflow_runs: [rest] }), 2, 2).hasMore).toBe(false);
    expect(() => parseActionRunPage('[]', 1, 50)).toThrow('unexpected response');
  });

  it('reads a run with its workflow file, and its jobs without placeholder times', () => {
    const run = parseActionRun(JSON.stringify({
      id: 42, name: 'CI', display_title: 'fix: links', run_number: 340, run_attempt: 2, workflow_id: 7, status: 'completed', conclusion: 'failure',
      event: 'pull_request', head_branch: 'feature', head_sha: 'b'.repeat(40), html_url: 'https://github.com/o/r/actions/runs/42',
      path: '.github/workflows/ci.yml@refs/heads/main', created_at: '2026-11-05T13:00:00Z', run_started_at: '2026-11-05T13:00:05Z', updated_at: '2026-11-05T13:05:00Z',
      actor: { login: 'author' }, triggering_actor: { login: 'rerunner' }, pull_requests: [{ number: 77 }],
    }));
    expect(run).toMatchObject({ id: 42, attempt: 2, path: '.github/workflows/ci.yml', actor: { login: 'rerunner', avatarUrl: null }, pullRequestNumber: 77, conclusion: 'failure', workflowName: 'CI' });

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

describe('branch names', () => {
  it('reads the names GitHub lists', async () => {
    const { parseBranchNames } = await import('./ActionRunParser');
    expect(parseBranchNames(JSON.stringify([{ name: 'main', commit: {} }, { name: 'feature/x' }]))).toEqual(['main', 'feature/x']);
    expect(() => parseBranchNames('{}')).toThrow('unexpected response');
  });
});
