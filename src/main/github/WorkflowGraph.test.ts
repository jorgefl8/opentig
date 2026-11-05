import { describe, expect, it } from 'vitest';
import { buildRunGraph, parseWorkflowJobs } from './WorkflowGraph';

const workflow = `
name: CI
on: [push]
jobs:
  changes:
    runs-on: ubuntu-latest
  validate:
    needs: changes
    strategy:
      matrix:
        os: [ubuntu-24.04, windows-latest]
  website:
    name: Website
    needs: [changes]
  smoke:
    name: Smoke \${{ matrix.os }}
    needs: [changes, validate, missing]
  deploy:
    uses: ./.github/workflows/deploy.yml
    needs: website
`;

describe('workflow graph', () => {
  it('reads each job of a workflow file with what it needs', () => {
    expect(parseWorkflowJobs(workflow)).toEqual([
      { id: 'changes', name: null, needs: [] },
      { id: 'validate', name: null, needs: ['changes'] },
      { id: 'website', name: 'Website', needs: ['changes'] },
      { id: 'smoke', name: 'Smoke ${{ matrix.os }}', needs: ['changes', 'validate', 'missing'] },
      { id: 'deploy', name: null, needs: ['website'] },
    ]);
    expect(parseWorkflowJobs('not: [valid')).toBeNull();
    expect(parseWorkflowJobs('name: no jobs')).toBeNull();
  });

  it('groups matrix, reusable and expression-named run jobs under the job that produced them', () => {
    const jobs = [
      { id: 1, name: 'changes' },
      { id: 2, name: 'validate (ubuntu-24.04)' },
      { id: 3, name: 'validate (windows-latest)' },
      { id: 4, name: 'Website' },
      { id: 5, name: 'Smoke ubuntu' },
      { id: 6, name: 'deploy / publish' },
      { id: 7, name: 'renamed job (x)' },
    ];
    const { graph, source } = buildRunGraph(parseWorkflowJobs(workflow), jobs);
    expect(source).toBe('workflow');
    expect(graph).toEqual([
      { id: 'changes', name: 'changes', needs: [], jobIds: [1] },
      { id: 'validate', name: 'validate', needs: ['changes'], jobIds: [2, 3] },
      { id: 'website', name: 'Website', needs: ['changes'], jobIds: [4] },
      { id: 'smoke', name: 'Smoke', needs: ['changes', 'validate'], jobIds: [5] },
      { id: 'deploy', name: 'deploy', needs: ['website'], jobIds: [6] },
      { id: 'job:renamed job', name: 'renamed job', needs: [], jobIds: [7] },
    ]);
  });

  it('still shows every job, unconnected, without the workflow file', () => {
    const { graph, source } = buildRunGraph(null, [{ id: 1, name: 'build (a)' }, { id: 2, name: 'build (b)' }, { id: 3, name: 'test' }]);
    expect(source).toBe('jobs');
    expect(graph).toEqual([
      { id: 'job:build', name: 'build', needs: [], jobIds: [1, 2] },
      { id: 'job:test', name: 'test', needs: [], jobIds: [3] },
    ]);
  });

  it('prefers the longest matching job name', () => {
    const definition = parseWorkflowJobs('jobs:\n  build: {}\n  docs:\n    name: build docs\n');
    const { graph } = buildRunGraph(definition, [{ id: 1, name: 'build docs (linux)' }, { id: 2, name: 'build (linux)' }]);
    expect(graph.map((node) => [node.id, node.jobIds])).toEqual([['build', [2]], ['docs', [1]]]);
  });
});
