import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startOpenCodeV2Server } from './open-code-server';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
});

describe('startOpenCodeV2Server', () => {
  it('parses the OpenCode 2 listen line and stops the child', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-opencode2-'));
    temporaryDirectories.push(directory);
    const script = path.join(directory, 'fake-serve.js');
    const authentication = path.join(directory, 'server-auth.json');
    await writeFile(script, [
      'require("node:fs").writeFileSync(process.env.TEST_AUTH_OUTPUT, JSON.stringify({ username: process.env.OPENCODE_SERVER_USERNAME, password: process.env.OPENCODE_SERVER_PASSWORD, config: process.env.OPENCODE_CONFIG }));',
      'const port = process.argv[process.argv.indexOf("--port") + 1];',
      'process.stdout.write("server listening on http://127.0.0.1:" + port + "\\n");',
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'));
    const executable = process.platform === 'win32' ? path.join(directory, 'fake-serve.cmd') : path.join(directory, 'fake-serve');
    if (process.platform === 'win32') {
      await writeFile(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    } else {
      await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
    }

    const server = await startOpenCodeV2Server({ executable, timeoutMs: 5_000,
      env: { TEST_AUTH_OUTPUT: authentication, OPENCODE_SERVER_USERNAME: 'inherited', OPENCODE_SERVER_PASSWORD: 'inherited', OPENCODE_CONFIG: 'untrusted.json' },
      removeEnv: ['OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_CONFIG'],
    });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.password).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(JSON.parse(await readFile(authentication, 'utf8'))).toEqual({ username: 'opencode', password: server.password });
    } finally {
      server.close();
    }
  });
});

describe('generateOpenCodeV2Text', () => {
  it.each([200, 429, 401, 400])('uses the v2 HTTP contract and cleans up after response %s', async (status) => {
    const { createServer } = await import('node:http');
    const { generateOpenCodeV2Text } = await import('./open-code-server');
    const requests: Array<{ method: string; url: string; auth: string | undefined; body: unknown }> = [];
    const http = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      requests.push({ method: request.method!, url: request.url!, auth: request.headers.authorization, body: raw ? JSON.parse(raw) : null });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/session') response.end(JSON.stringify({ data: { id: 'ses_test' } }));
      else if (request.method === 'DELETE') response.end('{}');
      else {
        response.statusCode = status;
        response.end(JSON.stringify(status === 200 ? { data: { text: '{"subject":"Add feature"}' } } : { message: status === 400 ? 'Unknown model' : 'Request rejected' }));
      }
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    try {
      const promise = generateOpenCodeV2Text({ url: `http://127.0.0.1:${address.port}`, password: 'test', close() {} }, {
        prompt: 'Generate text', model: 'openai/gpt-5.2#high', cwd: '/sample', signal: new AbortController().signal,
      });
      if (status === 200) expect(await promise).toBe('{"subject":"Add feature"}');
      else await expect(promise).rejects.toMatchObject({ detail: { code: status === 429 ? 'AI_RATE_LIMITED' : status === 401 ? 'AI_AUTH_REQUIRED' : 'AI_MODEL_UNAVAILABLE' } });
      expect(requests.map((request) => [request.method, request.url])).toEqual([
        ['POST', '/api/session'], ['POST', '/api/session/ses_test/generate'], ['DELETE', '/api/session/ses_test'],
      ]);
      expect(requests[0]?.body).toMatchObject({ location: { directory: '/sample' }, model: { providerID: 'openai', id: 'gpt-5.2', variant: 'high' }, permissions: [{ action: '*', resource: '*', effect: 'deny' }] });
      expect(requests.every((request) => request.auth === `Basic ${Buffer.from('opencode:test').toString('base64')}`)).toBe(true);
    } finally {
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('deletes the session when generation is cancelled', async () => {
    const { createServer } = await import('node:http');
    const { generateOpenCodeV2Text } = await import('./open-code-server');
    const controller = new AbortController();
    let deleted = false;
    const http = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/session') response.end(JSON.stringify({ data: { id: 'ses_cancel' } }));
      else if (request.method === 'DELETE') { deleted = true; response.end('{}'); }
      else controller.abort();
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    try {
      await expect(generateOpenCodeV2Text({ url: `http://127.0.0.1:${address.port}`, password: 'test', close() {} }, {
        prompt: 'Generate', model: 'default', cwd: '/sample', signal: controller.signal,
      })).rejects.toMatchObject({ detail: { code: 'AI_CANCELLED' } });
      expect(deleted).toBe(true);
    } finally {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
