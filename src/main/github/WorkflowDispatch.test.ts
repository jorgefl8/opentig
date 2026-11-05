import { describe, expect, it, vi } from 'vitest';
import { parseWorkflowTriggers } from './WorkflowDispatch';

describe('workflow triggers', () => {
  it('reads the inputs of a manual run', () => {
    expect(parseWorkflowTriggers(`
on:
  push:
  workflow_dispatch:
    inputs:
      version:
        description: Version without the leading v
        required: true
      prerelease:
        type: boolean
        default: false
      channel:
        type: choice
        options: [latest, next, 3]
        default: latest
      target:
        type: environment
      broken:
        type: choice
jobs: {}
`)).toEqual({
      events: ['push', 'workflow_dispatch'],
      inputs: [
        { name: 'version', description: 'Version without the leading v', required: true, default: null, type: 'string', options: [] },
        { name: 'prerelease', description: null, required: false, default: 'false', type: 'boolean', options: [] },
        { name: 'channel', description: null, required: false, default: 'latest', type: 'choice', options: ['latest', 'next', '3'] },
        { name: 'target', description: null, required: false, default: null, type: 'environment', options: [] },
        { name: 'broken', description: null, required: false, default: null, type: 'string', options: [] },
      ],
    });
  });

  it('tells manual workflows from automatic ones in every form of `on`', () => {
    expect(parseWorkflowTriggers('on: workflow_dispatch')).toEqual({ events: ['workflow_dispatch'], inputs: [] });
    expect(parseWorkflowTriggers('on: [push, workflow_dispatch]')).toEqual({ events: ['push', 'workflow_dispatch'], inputs: [] });
    expect(parseWorkflowTriggers('on:\n  pull_request:\n  push:\n')).toEqual({ events: ['pull_request', 'push'], inputs: null });
    expect(parseWorkflowTriggers('jobs: {}')).toBeNull();
    expect(parseWorkflowTriggers('on: [unclosed')).toBeNull();
  });
});

describe("GitHub's own workflows", () => {
  it('are automatic without reading a file that does not exist', async () => {
    const { GitHubActions } = await import('./GitHubActions');
    const github = { requireGitHub: vi.fn() };
    const actions = new GitHubActions(github as never);
    expect(await actions.workflowTriggers('repo', 'dynamic/dependabot/dependabot-updates', 'main')).toEqual({ events: ['dynamic'], inputs: null });
    expect(github.requireGitHub).not.toHaveBeenCalled();
  });
});
