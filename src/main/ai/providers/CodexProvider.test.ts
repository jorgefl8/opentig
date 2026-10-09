import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { CodexProvider } from './CodexProvider';

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function resolver(executable: string | null, codexHome: string): CliResolver {
  return { discover: vi.fn(async () => executable ? [{ executable, alias: 'codex', source: 'process-path', env: { CODEX_HOME: codexHome } }] : []), warning: async () => undefined } as unknown as CliResolver;
}

describe('CodexProvider.generate', () => {
  it('writes a structured-output schema with every property required', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'opentig-codex-test-')); temporaryDirectories.push(home);
    await writeFile(path.join(home, 'auth.json'), '{}');
    const captured: { schema: Record<string, unknown> | null } = { schema: null };
    const runner = {
      run: vi.fn(async (_executable: string, args: string[]) => {
        if (args[0] === '--version') return { exitCode: 0, stdout: 'codex 1.0', stderr: '' };
        const schemaPath = args[args.indexOf('--output-schema') + 1];
        if (!schemaPath) throw new Error('missing --output-schema');
        captured.schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Record<string, unknown>;
        return { exitCode: 1, stdout: '{"type":"error","message":"boom"}', stderr: '' };
      }),
    } as unknown as CliProcessRunner;
    const provider = new CodexProvider(resolver('C:\\codex.exe', home), runner);

    await expect(provider.generate({
      repositoryPath: 'C:\\repo',
      prompt: 'hello',
      schema: {
        type: 'object',
        properties: { subject: { type: 'string' }, body: { type: 'string' }, rationale: { type: 'string' } },
        required: ['subject', 'body'],
      },
      model: 'gpt-5.6-luna',
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(AiOperationError);

    expect(captured.schema?.required).toEqual(['subject', 'body', 'rationale']);
    expect(captured.schema?.$schema).toBeUndefined();
  });
});
