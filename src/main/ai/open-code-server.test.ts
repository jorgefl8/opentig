import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    await writeFile(script, [
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

    const server = await startOpenCodeV2Server({ executable, timeoutMs: 5_000 });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.password).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      server.close();
    }
  });
});
