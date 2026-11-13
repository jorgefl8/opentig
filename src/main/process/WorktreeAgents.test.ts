import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorktreeAgentsDetector, agentName, claudeLockPid, parseLsofWorkingDirectories } from './WorktreeAgents';
import { startFakeAgent, startIdleProcess } from './test-support/fake-agent';

const folders: string[] = [];
afterEach(() => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));
async function folder(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), 'opentig-agents-'));
  folders.push(created);
  return created;
}

describe('agentName', () => {
  it.each([
    ['claude', ['/home/me/.local/bin/claude', '--output-format', 'stream-json'], 'Claude Code'],
    ['node', ['node', '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'], 'Claude Code'],
    ['codex-x86_64-un', ['/usr/lib/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex/codex-x86_64-unknown-linux-musl'], 'Codex'],
    ['node', ['node', '/usr/local/bin/gemini'], 'Gemini CLI'],
    ['node', ['/usr/bin/node', '--no-warnings', '/usr/lib/node_modules/@github/copilot/index.js'], 'Copilot CLI'],
    ['.opencode', ['/home/me/.opencode/bin/.opencode'], 'OpenCode'],
    ['grok', ['/home/me/.grok/bin/grok'], 'Grok Build'],
    ['python3', ['python3', '-m', 'aider'], 'Aider'],
    ['claude.exe', ['C:\\Users\\me\\.local\\bin\\claude.exe'], 'Claude Code'],
  ])('recognizes %s %j as %s', (command, argv, expected) => {
    expect(agentName(command, argv)).toBe(expected);
  });

  it.each([
    // An editor's Copilot language server runs in the repository but isn't an agent working there.
    ['copilot-language-', ['/home/me/.vscode/extensions/github.copilot/dist/copilot-language-server']],
    ['node', ['node', '/repo/node_modules/vitest/vitest.mjs', 'run']],
    ['bash', ['bash', '-c', 'claude --help']],
  ])('ignores %s %j', (command, argv) => {
    expect(agentName(command, argv)).toBeNull();
  });
});

describe('claudeLockPid', () => {
  it('reads the process id from the reason Claude Code locks its worktrees with', () => {
    expect(claudeLockPid('claude agent agent-a1b2c3 (pid 4242 start 1234567)')).toBe(4242);
    expect(claudeLockPid('claude agent agent-a1b2c3 (pid 4242)')).toBe(4242);
  });

  it('leaves other locks alone', () => {
    expect(claudeLockPid('locked')).toBeNull();
    expect(claudeLockPid('on a removable drive (pid 4242)')).toBeNull();
    expect(claudeLockPid(null)).toBeNull();
  });
});

describe('parseLsofWorkingDirectories', () => {
  it('pairs each process with its working directory and skips processes without one', () => {
    expect(parseLsofWorkingDirectories('p101\nfcwd\nn/Users/me/repo\np202\nfcwd\np303\nfcwd\nn/Users/me/repo with space\n'))
      .toEqual(new Map([[101, '/Users/me/repo'], [303, '/Users/me/repo with space']]));
  });
});

describe('WorktreeAgentsDetector locks', () => {
  it('counts a Claude Code lock while its process runs, where processes can\'t be listed', async () => {
    const repository = await folder();
    const agent = await startIdleProcess();
    const detector = new WorktreeAgentsDetector({ scan: async () => null });
    const worktrees = [{ path: repository, locked: `claude agent agent-1 (pid ${agent.pid} start 99)` }];

    expect(await detector.find(worktrees)).toEqual([{ path: repository, agents: ['Claude Code'] }]);
    await agent.stop();
    expect(await new WorktreeAgentsDetector({ scan: async () => null }).find(worktrees)).toEqual([]);
  });

  it('ignores a lock whose process id now belongs to a program that is not an agent', async () => {
    const repository = await folder();
    const other = await startIdleProcess();
    const detector = new WorktreeAgentsDetector({ scan: async () => [] });

    expect(await detector.find([{ path: repository, locked: `claude agent agent-1 (pid ${other.pid})` }])).toEqual([]);
  });
});

describe.runIf(process.platform === 'linux')('WorktreeAgentsDetector processes', () => {
  it('assigns an agent to the innermost worktree holding its working directory', async () => {
    const main = await folder();
    const nested = path.join(main, '.claude', 'worktrees', 'task');
    await mkdir(path.join(nested, 'src'), { recursive: true });
    await startFakeAgent('claude', path.join(nested, 'src'));
    await startFakeAgent('codex', main);
    const detector = new WorktreeAgentsDetector({ ownPid: -1 });

    expect(await detector.find([{ path: main, locked: null }, { path: nested, locked: null }])).toEqual([
      { path: main, agents: ['Codex'] },
      { path: nested, agents: ['Claude Code'] },
    ]);
  });

  it('leaves out agents OpenTig started itself, such as for commit messages', async () => {
    const repository = await folder();
    await startFakeAgent('claude', repository);

    // The fake agent is a child of this process, which plays OpenTig here.
    expect(await new WorktreeAgentsDetector().find([{ path: repository, locked: null }])).toEqual([]);
  });
});
