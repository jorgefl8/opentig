import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner, CliRunOptions, CliRunResult } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { GrokProvider } from './GrokProvider';

const HELP = '--prompt-file --json-schema --output-format --tools --disallowed-tools --deny --disable-web-search --max-turns --permission-mode --verbatim';
const INSPECT = { hooks: [], plugins: [], mcpServers: [], projectInstructions: [] };
const originalOverlay = process.env.GROK_CONFIG;
afterEach(() => { if (originalOverlay === undefined) delete process.env.GROK_CONFIG; else process.env.GROK_CONFIG = originalOverlay; });

function fixture(response: CliRunResult = { exitCode: 0, stderr: '', stdout: JSON.stringify({ stopReason: 'end_turn', structuredOutput: { subject: 'Add feature', body: '' }, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } }) }) {
  const resolver = { discover: vi.fn(async () => [{ executable: '/bin/grok', alias: 'grok', source: 'process-path', env: {} }]), warning: async () => undefined } as unknown as CliResolver;
  const run = vi.fn(async (...call: [string, string[], CliRunOptions?]): Promise<CliRunResult> => {
    const args = call[1];
    const stdout = args[0] === '--version' ? 'grok 1.0.46 (revision) [stable]'
      : args[0] === '--help' ? HELP
      : args[0] === 'inspect' ? JSON.stringify(INSPECT)
      : 'You are using XAI_API_KEY.\nAvailable models:\n  * grok-test (default)\n';
    return args[0] === '--prompt-file' ? response : { exitCode: 0, stderr: '', stdout };
  });
  return { provider: new GrokProvider(resolver, { run } as unknown as CliProcessRunner), run, resolver };
}
const input = { repositoryPath: '/sample/repository', prompt: 'Diff context', schema: { type: 'object' }, model: 'grok-test', signal: new AbortController().signal };

describe('GrokProvider', () => {
  it('discovers status and removes the temporary profile', async () => {
    const { provider, run } = fixture();
    expect(await provider.status(true)).toMatchObject({ id: 'grok', installed: true, availability: 'ready', authStatus: 'authenticated', models: [{ id: 'default' }, { id: 'grok-test' }] });
    const temporary = run.mock.calls[0]?.[2]?.cwd;
    expect(temporary).toBeTruthy();
    await expect(access(temporary!)).rejects.toThrow();
  });
  it('writes large prompts to a protected temporary file and uses tool-free controls', async () => {
    process.env.GROK_CONFIG = '{"tools":"unsafe"}';
    const { provider, run } = fixture();
    let promptFile: string | undefined;
    run.mockImplementation(async (_executable, args, options) => {
      if (args[0] === '--version') return { exitCode: 0, stdout: 'grok 1.0.46', stderr: '' };
      if (args[0] === '--help') return { exitCode: 0, stdout: HELP, stderr: '' };
      if (args[0] === 'inspect') return { exitCode: 0, stdout: JSON.stringify(INSPECT), stderr: '' };
      promptFile = args[1];
      expect(await readFile(promptFile!, 'utf8')).toBe('x'.repeat(100_000));
      expect(options?.cwd).not.toBe(input.repositoryPath);
      expect(options?.env?.GROK_HOME).toBe(path.join(options!.cwd!, '.grok'));
      expect(options?.env?.GROK_AUTH_PATH).toBeTruthy();
      expect(options?.removeEnv).toContain('GROK_CONFIG');
      expect(args).toEqual(expect.arrayContaining(['--json-schema', JSON.stringify(input.schema), '--tools', 'read_file', '--disallowed-tools', 'read_file,search_tool,use_tool,Agent', '--deny', 'MCPTool', '--model', 'grok-test']));
      return { exitCode: 0, stdout: '{"stopReason":"end_turn","structuredOutput":{"subject":"Add feature"}}', stderr: '' };
    });
    expect(await provider.generate({ ...input, prompt: 'x'.repeat(100_000) })).toMatchObject({ output: { subject: 'Add feature' } });
    await expect(access(promptFile!)).rejects.toThrow();
  });
  it.each(['hooks', 'plugins', 'mcpServers', 'projectInstructions'])('blocks generation when inspect reports %s', async (key) => {
    const { provider, run } = fixture();
    run.mockImplementation(async (_executable, args) => ({ exitCode: 0, stderr: '', stdout: args[0] === '--version' ? 'grok 1.0.46' : args[0] === '--help' ? HELP : JSON.stringify({ ...INSPECT, [key]: [{}] }) }));
    await expect(provider.generate(input)).rejects.toMatchObject({ detail: { code: 'AI_PROCESS_FAILED' } });
    expect(run.mock.calls.some(([, args]) => args[0] === '--prompt-file')).toBe(false);
  });
  it('rejects older versions before inspecting or generating', async () => {
    const { provider, run } = fixture();
    run.mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'grok 1.0.40' });
    expect(await provider.status()).toMatchObject({ installed: true, availability: 'error' });
    await expect(provider.generate(input)).rejects.toMatchObject({ detail: { code: 'AI_PROCESS_FAILED' } });
    expect(run.mock.calls.every(([, args]) => args[0] === '--version')).toBe(true);
  });
  it.each([['not authenticated', 'AI_AUTH_REQUIRED'], ['usage quota exceeded', 'AI_RATE_LIMITED'], ['unknown model', 'AI_MODEL_UNAVAILABLE'], ['failed request', 'AI_PROCESS_FAILED']])('maps %s without echoing diagnostics', async (stderr, code) => {
    const { provider, run } = fixture({ exitCode: 1, stdout: '', stderr: `${stderr}: private prompt content` });
    await expect(provider.generate(input)).rejects.toMatchObject({ detail: { code } });
    try { await provider.generate(input); } catch (error) { expect((error as Error).message).not.toContain('private prompt content'); }
    await expect(access(run.mock.calls[0]![2]!.cwd!)).rejects.toThrow();
  });
  it('cleans temporary state after cancellation', async () => {
    const controller = new AbortController();
    const { provider, run } = fixture();
    run.mockImplementation(async (_executable, args) => {
      if (args[0] === '--version') return { exitCode: 0, stderr: '', stdout: 'grok 1.0.46' };
      controller.abort();
      throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'test', message: 'cancelled' });
    });
    await expect(provider.generate({ ...input, signal: controller.signal })).rejects.toMatchObject({ detail: { code: 'AI_CANCELLED' } });
    await expect(access(run.mock.calls[0]![2]!.cwd!)).rejects.toThrow();
  });
});
