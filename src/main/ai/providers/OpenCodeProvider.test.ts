import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { generateOpenCodeV2Text, startOpenCodeV2Server } from '../open-code-server';
import { OpenCodeProvider } from './OpenCodeProvider';

vi.mock('../open-code-server', () => ({ startOpenCodeV2Server: vi.fn(), generateOpenCodeV2Text: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function fixture(candidates: string[], versions: Record<string, string> = {}) {
  const resolver = { discover: vi.fn(async () => candidates.map((executable) => ({ executable, alias: 'opencode', source: 'process-path', env: { PATH: '/fixture/bin' } }))), warning: async () => undefined } as unknown as CliResolver;
  const run = vi.fn(async (executable: string, args: string[]) => ({
    exitCode: 0, stderr: '',
    stdout: args[0] === '--version' ? versions[executable] ?? '2.0.22'
      : args[0] === 'auth' ? '[{"id":"anthropic","connections":[{"type":"credential","label":"account"}]}]'
      : 'anthropic/claude-sonnet-4#high\n',
  }));
  return { provider: new OpenCodeProvider(resolver, { run } as unknown as CliProcessRunner), run, resolver };
}

const input = { repositoryPath: '/sample', prompt: 'Generate a commit message.', schema: { type: 'object' }, model: 'default', signal: new AbortController().signal };

describe('OpenCodeProvider', () => {
  it.each(['/bin/opencode', '/bin/opencode2'])('recognizes v2 at %s and probes standalone metadata', async (executable) => {
    const { provider, run } = fixture([executable]);
    expect(await provider.status()).toMatchObject({ installed: true, availability: 'ready', version: '2.0.22', authStatus: 'authenticated' });
    expect(run).toHaveBeenCalledWith(executable, ['models', '--standalone'], { timeoutMs: 30_000, env: { PATH: '/fixture/bin' } });
    expect((await provider.status()).models.map((model) => model.id)).toEqual(['default', 'anthropic/claude-sonnet-4#high']);
  });

  it('chooses a compatible alternate binary when the main command is v1', async () => {
    const { provider, run } = fixture(['/bin/opencode', '/bin/opencode2'], { '/bin/opencode': '1.15.13' });
    expect(await provider.status(true)).toMatchObject({ cliName: 'opencode2', version: '2.0.22', availability: 'ready' });
    expect(run).not.toHaveBeenCalledWith('/bin/opencode', ['models', '--standalone'], expect.anything());
  });

  it.each(['1.15.13', 'opencode2 v0.0.0-beta-18155', 'unknown', '3.0.0'])('blocks incompatible version %s at status and generation', async (version) => {
    const { provider, run } = fixture(['/bin/opencode'], { '/bin/opencode': version });
    expect(await provider.status()).toMatchObject({ installed: true, availability: 'error', authStatus: 'unknown', message: expect.stringContaining('OpenCode 2.x is required') });
    await expect(provider.generate(input)).rejects.toMatchObject({ detail: { code: 'AI_PROCESS_FAILED', message: expect.stringContaining('opencode could not be started') } });
    expect(run.mock.calls.every(([, args]) => args[0] === '--version')).toBe(true);
    expect(startOpenCodeV2Server).not.toHaveBeenCalled();
  });

  it('reports an absent CLI and forwards refresh to the resolver', async () => {
    const { provider, resolver } = fixture([]);
    expect(await provider.status(true)).toMatchObject({ installed: false, availability: 'error' });
    expect(resolver.discover).toHaveBeenCalledWith('opencode', true, false);
    await expect(provider.generate(input)).rejects.toMatchObject({ detail: { code: 'AI_CLI_NOT_FOUND' } });
  });

  it('keeps free models usable without claiming confirmed authentication', async () => {
    const { provider, run } = fixture(['/bin/opencode']);
    run.mockImplementation(async (_executable, args) => ({ exitCode: 0, stderr: '', stdout: args[0] === '--version' ? '2.0.22' : args[0] === 'auth' ? '[]' : 'opencode/free-model' }));
    expect(await provider.status()).toMatchObject({ installed: true, availability: 'warning', authStatus: 'unknown' });
  });

  it('includes the schema and always closes its private server', async () => {
    const { provider } = fixture(['/bin/opencode']);
    const close = vi.fn();
    vi.mocked(startOpenCodeV2Server).mockResolvedValue({ url: 'http://127.0.0.1:1234', password: 'test', close });
    vi.mocked(generateOpenCodeV2Text).mockResolvedValue('{"subject":"Add feature","body":""}');
    expect(await provider.generate(input)).toMatchObject({ output: { subject: 'Add feature', body: '' }, usage: { inputTokens: null } });
    expect(startOpenCodeV2Server).toHaveBeenCalledWith(expect.objectContaining({ env: { PATH: '/fixture/bin' } }));
    expect(generateOpenCodeV2Text).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ prompt: expect.stringContaining(JSON.stringify(input.schema)) }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the server on malformed output', async () => {
    const { provider } = fixture(['/bin/opencode']);
    const close = vi.fn();
    vi.mocked(startOpenCodeV2Server).mockResolvedValue({ url: 'http://127.0.0.1:1234', password: 'test', close });
    vi.mocked(generateOpenCodeV2Text).mockResolvedValue('not JSON');
    await expect(provider.generate(input)).rejects.toMatchObject({ detail: { code: 'AI_INVALID_OUTPUT' } });
    expect(close).toHaveBeenCalledOnce();
  });
});
