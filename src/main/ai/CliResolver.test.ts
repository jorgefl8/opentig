import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliResolver } from './CliResolver';

const temporaryDirectories: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })));
});

describe('CliResolver', () => {
  it('resolves only a fixed CLI name from PATH', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-resolver-'));
    temporaryDirectories.push(directory);
    const executable = path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
    await writeFile(executable, '');
    process.env.PATH = directory;
    expect(await new CliResolver().resolve('codex')).toBe(executable);
  });

  it('resolves OpenCode 2 when only opencode2 is on PATH', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-resolver-'));
    temporaryDirectories.push(directory);
    const executable = path.join(directory, process.platform === 'win32' ? 'opencode2.cmd' : 'opencode2');
    await writeFile(executable, '');
    process.env.PATH = directory;
    expect(await new CliResolver().resolve('opencode')).toBe(executable);
  });

  it('prefers OpenCode 1 over OpenCode 2 when both are on PATH', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opentig-resolver-'));
    temporaryDirectories.push(directory);
    const v1 = path.join(directory, process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    const v2 = path.join(directory, process.platform === 'win32' ? 'opencode2.cmd' : 'opencode2');
    await writeFile(v1, '');
    await writeFile(v2, '');
    process.env.PATH = directory;
    expect(await new CliResolver().resolve('opencode')).toBe(v1);
  });
});
