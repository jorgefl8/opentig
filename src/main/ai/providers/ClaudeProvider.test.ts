import { access } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import type { CliProcessRunner, CliRunOptions } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { ClaudeProvider } from './ClaudeProvider';

it('runs Claude outside the repository with safe-mode, hooks disabled, and no built-in or MCP tools', async () => {
  let cwd = '';
  const run = vi.fn(async (_command: string, args: string[], options: CliRunOptions) => {
    if (args[0] === '--version') return { exitCode: 0, stdout: '2.1.300', stderr: '' };
    cwd = options.cwd!;
    expect(cwd).not.toBe('/repository');
    expect(args).toEqual(expect.arrayContaining(['--safe-mode', '--strict-mcp-config', '--no-session-persistence']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({ disableAllHooks: true });
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!)).toEqual({ mcpServers: {} });
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__*');
    expect(options.removeEnv).toContain('ANTHROPIC_AUTH_TOKEN');
    return { exitCode: 0, stdout: '{"structured_output":{"subject":"Update app","body":""}}', stderr: '' };
  });
  const resolver = { discover: async () => [{ executable: '/cli/claude', alias: 'claude', source: 'process-path', env: {} }], warning: async () => undefined } as unknown as CliResolver;
  const provider = new ClaudeProvider(resolver, { run } as unknown as CliProcessRunner);
  expect(await provider.generate({ repositoryPath: '/repository', prompt: 'Draft', schema: {}, model: 'default', signal: new AbortController().signal })).toMatchObject({ output: { subject: 'Update app' } });
  await expect(access(cwd)).rejects.toThrow();
});
