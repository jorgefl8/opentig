import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { access, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliProcessRunner, type CliRunOptions } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { GrokProvider } from './GrokProvider';

// Optional real-CLI contract check: a local model fixture uses no xAI account,
// tokens or remote credits. The production adapter never adds custom models.
const executable = process.env.OPENTIG_TEST_GROK_CLI;
describe.skipIf(!executable)('GrokProvider real CLI contract', () => {
  it('generates tool-free structured text and cleans up after real process cancellation', async () => {
    const requests: Record<string, unknown>[] = [];
    let hanging = false;
    let reached: (() => void) | undefined;
    const responses = new Set<ServerResponse>();
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"data":[]}'); return; }
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      responses.add(response);
      response.once('close', () => responses.delete(response));
      if (hanging) { reached?.(); return; }
      const content = JSON.stringify({ subject: 'Add validation', body: '' });
      const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
      const common = { id: 'fixture', created: 1, model: 'validation' };
      if (body.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const event of [
          { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
          { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
        ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end('data: [DONE]\n\n');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const runner = new CliProcessRunner();
    const roots: string[] = [];
    const isolatedRunner = { run: async (command: string, args: string[], options: CliRunOptions) => {
      if (args[0] === '--prompt-file') {
        roots.push(options.cwd!);
        await appendFile(path.join(options.env!.GROK_HOME!, 'config.toml'), `\n[models]\ndefault="opentig-validation"\n[model.opentig-validation]\nmodel="validation"\nbase_url="http://127.0.0.1:${address.port}/v1"\napi_key="test"\n`);
      }
      return runner.run(command, args, { ...options, env: { ...options.env, GROK_AUTH_PATH: path.join(options.cwd!, 'absent-auth.json') }, removeEnv: [...(options.removeEnv ?? []), 'GROK_AUTH', 'XAI_API_KEY', 'GROK_CODE_XAI_API_KEY'] });
    } } as unknown as CliProcessRunner;
    const provider = new GrokProvider({ resolve: async () => executable! } as unknown as CliResolver, isolatedRunner);
    const input = { repositoryPath: '/sample/repository', prompt: 'Return a subject and body JSON object.', schema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] }, model: 'default', signal: new AbortController().signal };
    try {
      expect(await provider.generate(input)).toMatchObject({ output: { subject: 'Add validation', body: '' }, usage: { inputTokens: 3, outputTokens: 2, costUsd: null } });
      const generation = requests.find((body) => !!body.response_format);
      expect(generation).toBeTruthy();
      expect(generation?.tools ?? []).toEqual([]);
      await expect(access(roots[0]!)).rejects.toThrow();
      hanging = true;
      const pendingRequest = new Promise<void>((resolve) => { reached = resolve; });
      const controller = new AbortController();
      const pending = provider.generate({ ...input, signal: controller.signal });
      const rejected = expect(pending).rejects.toMatchObject({ detail: { code: 'AI_CANCELLED' } });
      await pendingRequest;
      controller.abort();
      await rejected;
      await expect(access(roots[1]!)).rejects.toThrow();
    } finally {
      await runner.close();
      for (const response of responses) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});
