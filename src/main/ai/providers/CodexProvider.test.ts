import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { CodexProvider } from './CodexProvider';

function resolver(executable: string | null): CliResolver {
  return { resolve: vi.fn(async () => executable) } as unknown as CliResolver;
}

describe('CodexProvider.generate', () => {
  it('writes a structured-output schema with every property required', async () => {
    const captured: { schema: Record<string, unknown> | null } = { schema: null };
    const runner = {
      run: vi.fn(async (_executable: string, args: string[]) => {
        const schemaPath = args[args.indexOf('--output-schema') + 1];
        if (!schemaPath) throw new Error('missing --output-schema');
        captured.schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Record<string, unknown>;
        return { exitCode: 1, stdout: '{"type":"error","message":"boom"}', stderr: '' };
      }),
    } as unknown as CliProcessRunner;
    const provider = new CodexProvider(resolver('C:\\codex.exe'), runner);

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
