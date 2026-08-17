import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliProcessRunner } from './CliProcessRunner';

describe('CliProcessRunner', () => {
  it('passes stdin and captures output', async () => {
    const runner = new CliProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { stdin: 'staged context', timeoutMs: 5_000 });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'staged context' });
  });

  it('captures stderr separately', async () => {
    const runner = new CliProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stderr.write("problem")'], { timeoutMs: 5_000 });
    expect(result).toMatchObject({ exitCode: 0, stdout: '', stderr: 'problem' });
  });

  it('returns a nonzero exit code without exposing it as a spawn failure', async () => {
    const runner = new CliProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 5_000 });
    expect(result.exitCode).toBe(7);
  });

  it('bounds process output', async () => {
    const runner = new CliProcessRunner();
    await expect(runner.run(process.execPath, ['-e', 'process.stdout.write("x".repeat(2048))'], { maxOutputBytes: 32, timeoutMs: 5_000 })).rejects.toMatchObject({ detail: { code: 'AI_CONTEXT_TOO_LARGE' } });
  });

  it('maps spawn failures', async () => {
    const runner = new CliProcessRunner();
    await expect(runner.run('justgit-command-that-does-not-exist', [], { timeoutMs: 5_000 })).rejects.toMatchObject({ detail: { code: 'AI_PROCESS_FAILED' } });
    await expect(runner.run(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: join(tmpdir(), `justgit-missing-cwd-${Date.now()}`),
      timeoutMs: 5_000,
    })).rejects.toMatchObject({ detail: { code: 'AI_PROCESS_FAILED' } });
  });

  it('maps timeouts', async () => {
    const runner = new CliProcessRunner();
    await expect(runner.run(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { timeoutMs: 100 })).rejects.toMatchObject({ detail: { code: 'AI_TIMEOUT' } });
  });

  it('maps cancellation before and during execution', async () => {
    const runner = new CliProcessRunner();
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    await expect(runner.run(process.execPath, ['-e', 'process.exit(0)'], { signal: alreadyCancelled.signal })).rejects.toMatchObject({ detail: { code: 'AI_CANCELLED' } });

    const running = new AbortController();
    const result = runner.run(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { signal: running.signal, timeoutMs: 5_000 });
    setTimeout(() => running.abort(), 100);
    await expect(result).rejects.toMatchObject({ detail: { code: 'AI_CANCELLED' } });
  });

  it('merges and removes environment variables', async () => {
    const runner = new CliProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stdout.write(`${process.env.JUSTGIT_KEEP ?? ""}|${process.env.JUSTGIT_REMOVE ?? "missing"}`)'], {
      env: { JUSTGIT_KEEP: 'kept', JUSTGIT_REMOVE: 'removed' },
      removeEnv: ['JUSTGIT_REMOVE'],
      timeoutMs: 5_000,
    });
    expect(result.stdout).toBe('kept|missing');
  });

  it('kills descendant processes when cancelled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'justgit-cli-tree-'));
    const pidPath = join(directory, 'child.pid');
    const controller = new AbortController();
    let descendantPid: number | undefined;
    try {
      const script = [
        'const { spawn } = require("node:child_process")',
        'const { writeFileSync } = require("node:fs")',
        `const child = spawn(${JSON.stringify(process.execPath)}, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })`,
        `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid))`,
        'setInterval(() => {}, 1000)',
      ].join(';');
      const run = new CliProcessRunner().run(process.execPath, ['-e', script], { signal: controller.signal, timeoutMs: 10_000 });
      descendantPid = Number(await waitForFile(pidPath));
      controller.abort();
      await expect(run).rejects.toMatchObject({ detail: { code: 'AI_CANCELLED' } });
      await waitForExit(descendantPid);
    } finally {
      if (descendantPid !== undefined && isAlive(descendantPid)) {
        try { process.kill(descendantPid, 'SIGKILL'); } catch { /* Process already exited. */ }
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await readFile(path, 'utf8'); } catch { await delay(25); }
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isAlive(pid)) return;
    await delay(25);
  }
  throw new Error(`Descendant process ${pid} was not terminated.`);
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
