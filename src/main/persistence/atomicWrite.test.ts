import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupPathFor, writeFileAtomically } from './atomicWrite';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
});

async function tempFile(name: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-atomic-'));
  directories.push(directory);
  return path.join(directory, name);
}

describe('writeFileAtomically', () => {
  it('replaces the target with synced contents', async () => {
    const file = await tempFile('state.json');
    await writeFile(file, '{"old":true}');
    await writeFileAtomically(file, '{\n  "ok": true\n}', { parseJson: true });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: true });
  });

  it('refuses to replace a good file when the payload is not JSON', async () => {
    const file = await tempFile('state.json');
    await writeFile(file, '{"keep":true}');
    await expect(writeFileAtomically(file, '{corrupt', { parseJson: true })).rejects.toThrow(SyntaxError);
    expect(await readFile(file, 'utf8')).toBe('{"keep":true}');
  });

  it('writes non-JSON secrets without parsing', async () => {
    const file = await tempFile('admin-token');
    await writeFileAtomically(file, 'token-value\n');
    expect(await readFile(file, 'utf8')).toBe('token-value\n');
  });

  it('names the backup beside the document', () => {
    expect(backupPathFor('C:\\data\\settings.json').replace(/\\/g, '/')).toMatch(/settings\.json\.bak$/);
  });
});
