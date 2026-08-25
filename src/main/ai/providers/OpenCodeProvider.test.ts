import { describe, expect, it, vi } from 'vitest';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { OpenCodeProvider } from './OpenCodeProvider';

function resolver(executable: string | null): CliResolver {
  return { resolve: vi.fn(async () => executable) } as unknown as CliResolver;
}

function runner(responses: Record<string, { exitCode: number; stdout: string; stderr?: string }>): CliProcessRunner {
  return {
    run: vi.fn(async (_executable: string, args: string[]) => {
      const key = args.join(' ');
      return { exitCode: 0, stdout: '', stderr: '', ...responses[key] };
    }),
  } as unknown as CliProcessRunner;
}

describe('OpenCodeProvider.status', () => {
  it('reports OpenCode 2 as installed with its CLI name and catalog', async () => {
    const provider = new OpenCodeProvider(resolver('C:\\npm\\opencode2.cmd'), runner({
      '--version': { exitCode: 0, stdout: 'opencode2 v0.0.0-beta-18155\n' },
      'auth list': { exitCode: 0, stdout: 'No authenticated integrations\n' },
      'models --standalone': { exitCode: 0, stdout: 'opencode/big-pickle\nopencode/hy3-free\n' },
    }));
    const status = await provider.status();
    expect(status).toMatchObject({
      installed: true,
      cliName: 'opencode2',
      version: 'opencode2 v0.0.0-beta-18155',
      authStatus: 'unknown',
      availability: 'warning',
    });
    expect(status.models.map((model) => model.id)).toEqual(['default', 'opencode/big-pickle', 'opencode/hy3-free']);
  });

  it('asks for opencode2 login when OpenCode 2 has no catalog and no credentials', async () => {
    const provider = new OpenCodeProvider(resolver('/usr/bin/opencode2'), runner({
      '--version': { exitCode: 0, stdout: 'opencode2 v0.0.0-beta-18155' },
      'auth list': { exitCode: 0, stdout: 'No authenticated integrations' },
      'models --standalone': { exitCode: 0, stdout: '' },
    }));
    await expect(provider.status()).resolves.toMatchObject({
      installed: true,
      cliName: 'opencode2',
      authStatus: 'unauthenticated',
      availability: 'error',
      message: 'Run opencode2 auth login.',
    });
  });

  it('keeps the OpenCode 1 credential probe', async () => {
    const provider = new OpenCodeProvider(resolver('/usr/bin/opencode'), runner({
      '--version': { exitCode: 0, stdout: '1.15.13' },
      'auth list': { exitCode: 0, stdout: 'Credentials\nanthropic\n' },
      models: { exitCode: 0, stdout: 'anthropic/claude-sonnet-4\n' },
    }));
    await expect(provider.status()).resolves.toMatchObject({
      installed: true,
      cliName: 'opencode',
      authStatus: 'authenticated',
      availability: 'ready',
    });
  });
});
