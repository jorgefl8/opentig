import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliProcessRunner, type CliRunOptions } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { CodexProvider } from './CodexProvider';

const executable = process.env.OPENTIG_TEST_CODEX_CLI;
// This contract check captures a real CLI request at a local rejecting model
// endpoint; it never uses an account, performs inference or spends credits.
describe.skipIf(!executable)('Codex isolated generation real CLI contract', () => {
  it('excludes repository and global instructions and agent tools from the model request', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opentig-codex-contract-'));
    const userHome = path.join(root, 'user'); const repository = path.join(root, 'repo');
    await Promise.all([userHome, repository].map(dir => mkdir(dir)));
    await writeFile(path.join(userHome, 'auth.json'), '{"OPENAI_API_KEY":"fake-validation-key"}');
    await writeFile(path.join(userHome, 'AGENTS.md'), 'GLOBAL_INSTRUCTIONS_MARKER');
    await writeFile(path.join(repository, 'AGENTS.md'), 'REPO_INSTRUCTIONS_MARKER');
    const requests: Record<string, unknown>[] = [];
    const server = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk;
      requests.push(JSON.parse(raw) as Record<string, unknown>);
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end('{"error":{"message":"Validation endpoint refuses inference","type":"invalid_request_error"}}');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
    const runner = new CliProcessRunner(); let temporary = '';
    const isolatedRunner = { run: async (command: string, args: string[], options: CliRunOptions) => {
      if (args[0] !== 'exec') return runner.run(command, args, options);
      temporary = options.cwd!;
      const configs = ['model_provider="opentig_validation"', 'model_providers.opentig_validation.name="Local validation"',
        `model_providers.opentig_validation.base_url="http://127.0.0.1:${address.port}"`, 'model_providers.opentig_validation.wire_api="responses"',
        'model_providers.opentig_validation.requires_openai_auth=false', 'model_providers.opentig_validation.request_max_retries=0'];
      const controlled = [...args.slice(0, -1), ...configs.flatMap(config => ['--config', config]), '-'];
      return runner.run(command, controlled, options);
    } } as unknown as CliProcessRunner;
    const resolver = { discover: async () => [{ executable: executable!, alias: 'codex', source: 'configured', env: { CODEX_HOME: userHome } }], warning: async () => undefined } as unknown as CliResolver;
    try {
      await expect(new CodexProvider(resolver, isolatedRunner).generate({ repositoryPath: repository, prompt: 'Return a JSON subject and body.', schema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] }, model: 'default', signal: new AbortController().signal })).rejects.toMatchObject({ detail: { code: 'AI_PROCESS_FAILED' } });
      expect(requests.length).toBeGreaterThan(0);
      expect(JSON.stringify(requests)).not.toMatch(/GLOBAL_INSTRUCTIONS_MARKER|REPO_INSTRUCTIONS_MARKER/);
      expect(requests[0]?.tools ?? []).toEqual([]);
      await expect(access(temporary)).rejects.toThrow();
    } finally {
      await runner.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
