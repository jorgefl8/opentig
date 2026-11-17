import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GitProcess } from './GitProcess';

// Spawning a `git -c alias.x=!node …` costs git -> sh -> node per case, which is
// slow on Git for Windows. Commands built with `node()` keep the real execa
// spawn, timeout, cancellation and descendant-kill options from GitProcess but
// launch Node directly. `alias()` keeps the real Git round trip.
const NODE_COMMAND = 'opentig-test-node';
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  const execa = ((file: string, args: readonly string[], options: object) => {
    const index = args.indexOf(NODE_COMMAND);
    return index < 0 ? actual.execa(file, args, options) : actual.execa(process.execPath, ['-e', args[index + 1]!], options);
  }) as unknown as typeof actual.execa;
  return { ...actual, execa };
});

describe('GitProcess', () => {
  it('does not share reads that report progress to their own consumer', async () => {
    const git = new GitProcess();
    const args = node('setTimeout(() => process.stdout.write(String(process.pid)), 50)');
    const outputs = await Promise.all(Array.from({ length: 2 }, () => git.run(process.cwd(), args, { operation: 'consumer-pid', readOnly: true, timeoutMs: 5_000, onStderr: () => undefined })));
    expect(new Set(outputs.map(output => output.stdout.toString())).size).toBe(2);
  });

  it('shares identical reads that can be cancelled, and stops the process only once every caller has cancelled', async () => {
    const git = new GitProcess();
    const directory = await mkdtemp(join(tmpdir(), 'opentig-shared-cancel-'));
    try {
      const finished = join(directory, 'finished');
      const args = node(`setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(finished)}, ''); process.stdout.write(String(process.pid)); }, 400)`);
      const options = (signal: AbortSignal) => ({ operation: 'shared-cancel', readOnly: true, timeoutMs: 5_000, signal });
      // Two clients reading the same thing run Git once.
      const both = await Promise.all([git.run(process.cwd(), [...args, 'shared'], options(new AbortController().signal)), git.run(process.cwd(), [...args, 'shared'], options(new AbortController().signal))]);
      expect(both[0].stdout.toString()).toBe(both[1].stdout.toString());
      // A click and a read ahead of it, both able to give up.
      const click = new AbortController();
      const ahead = new AbortController();
      const clicked = git.run(process.cwd(), args, options(click.signal));
      const readAhead = git.run(process.cwd(), args, options(ahead.signal));
      click.abort();
      await expect(clicked).rejects.toMatchObject({ name: 'AbortError' });
      // The other caller still waits, so the one process runs on and answers it.
      expect((await readAhead).stdout.toString()).toMatch(/^\d+$/);

      const first = new AbortController();
      const second = new AbortController();
      const reads = [git.run(process.cwd(), [...args, 'again'], options(first.signal)), git.run(process.cwd(), [...args, 'again'], options(second.signal))];
      await rm(finished, { force: true });
      first.abort();
      second.abort();
      await Promise.allSettled(reads);
      await new Promise((resolve) => setTimeout(resolve, 700));
      // Nobody was left waiting: the process was stopped before it finished.
      await expect(readFile(finished)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses one child process for four identical reads and fresh processes after settlement', async () => {
    const git = new GitProcess();
    const args = node('setTimeout(() => process.stdout.write(String(process.pid)), 50)');
    const options = { operation: 'read-pid', readOnly: true, timeoutMs: 5_000 };
    const outputs = await Promise.all(Array.from({ length: 4 }, () => git.run(process.cwd(), args, options)));
    const pid = outputs[0]!.stdout.toString();
    expect(outputs.every(output => output.stdout.toString() === pid)).toBe(true);
    outputs[0]!.stdout.fill(0);
    expect(outputs[1]!.stdout.toString()).toBe(pid);
    expect((await git.run(process.cwd(), args, options)).stdout.toString()).not.toBe(pid);
  });

  it('names the command that wrote when it invalidates reads, past any -c options', async () => {
    const git = new GitProcess();
    const listener = vi.fn();
    git.onInvalidate(listener);
    await git.runWrite(process.cwd(), ['-c', 'color.ui=false', 'status', '--short'], { operation: 'status-write', timeoutMs: 5_000 });
    // The write lock's own invalidations name the command too, so a fetch's lock doesn't restart what ignores a fetch.
    expect(listener.mock.calls.map(([, command]) => command)).toEqual(['status', 'status', 'status', 'status']);
    git.invalidate(process.cwd());
    expect(listener).toHaveBeenLastCalledWith(expect.any(String), undefined);
  });

  it('does not share writers or reads with different stdin', async () => {
    const git = new GitProcess();
    const args = node('process.stdout.write(String(process.pid))');
    const writes = await Promise.all(Array.from({ length: 2 }, () => git.runWrite(process.cwd(), args, { operation: 'write-pid', timeoutMs: 5_000 })));
    expect(new Set(writes.map(output => output.stdout.toString())).size).toBe(2);
    const hashes = await Promise.all(['one', 'two'].map(stdin => git.run(process.cwd(), ['hash-object', '--stdin'], {
      operation: 'hash', readOnly: true, stdin,
    })));
    expect(hashes[0]!.stdout.toString()).not.toBe(hashes[1]!.stdout.toString());
  });

  it('maps nonzero Git exits without changing their diagnostics', async () => {
    await expect(new GitProcess().run(process.cwd(), ['rev-parse', '--verify', 'refs/heads/opentig-ref-that-does-not-exist'], {
      operation: 'inspect',
      readOnly: true,
      timeoutMs: 5_000,
    })).rejects.toMatchObject({ detail: { code: 'UNKNOWN', operation: 'inspect', exitCode: 128 } });
  });

  it('cancels an individual operation and releases the process', async () => {
    const git = new GitProcess(), controller = new AbortController();
    const run = git.run(process.cwd(), node('setInterval(() => {}, 1000)'), { operation: 'cancel-test', signal: controller.signal, timeoutMs: 10_000 });
    const settled = expect(run).rejects.toThrow('cancelled');
    await delay(100); controller.abort(); await settled;
    expect(git.hasActiveProcess()).toBe(false);
    expect((await git.status()).state).toBe('ready');
  });

  it('maps a missing commit identity to its own code', async () => {
    const work = await mkdtemp(join(tmpdir(), 'opentig-identity-'));
    try {
      const git = new GitProcess();
      await git.run(work, ['init', '--quiet'], { operation: 'init', timeoutMs: 5_000 });
      await expect(git.run(work, ['-c', 'user.name=', 'commit', '--allow-empty', '-m', 'test'], { operation: 'commit', timeoutMs: 5_000 }))
        .rejects.toMatchObject({ detail: { code: 'IDENTITY_UNKNOWN', operation: 'commit' } });
    } finally { await rm(work, { recursive: true, force: true }); }
  });

  it('cancels owned processes during bounded close', async () => {
    const git = new GitProcess();
    const running = git.run(process.cwd(), node('setInterval(() => {}, 1000)'), {
      operation: 'close-wait',
      readOnly: true,
      timeoutMs: 10_000,
    });
    const settled = expect(running).rejects.toMatchObject({ detail: { operation: 'close-wait' } });
    await delay(100);

    await git.close();
    await settled;
    expect(git.hasActiveProcess()).toBe(false);
    await expect(git.run(process.cwd(), ['status'], {
      operation: 'after-close', readOnly: true,
    })).rejects.toMatchObject({ detail: { operation: 'after-close', message: 'Git runtime is closed.' } });
  });

  it('maps timeouts and kills descendant processes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opentig-git-tree-'));
    const pidPath = join(directory, 'child.pid');
    let descendantPid: number | undefined;
    try {
      const script = [
        'const {spawn}=require("node:child_process")',
        'const {writeFileSync}=require("node:fs")',
        `const child=spawn(${JSON.stringify(process.execPath)},["-e","setInterval(() => {}, 1000)"],{stdio:"ignore"})`,
        `writeFileSync(${JSON.stringify(pidPath)},String(child.pid))`,
        'setInterval(() => {}, 1000)',
      ].join(';');
      const run = new GitProcess().run(process.cwd(), node(script), {
        operation: 'tree-timeout',
        readOnly: true,
        timeoutMs: 500,
      });
      descendantPid = Number(await waitForFile(pidPath));
      await expect(run).rejects.toMatchObject({ detail: { code: 'TIMEOUT', operation: 'tree-timeout' } });
      await waitForExit(descendantPid);
    } finally {
      if (descendantPid !== undefined && isAlive(descendantPid)) {
        try { process.kill(descendantPid, 'SIGKILL'); } catch { /* Process already exited. */ }
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('enforces one combined stdout and stderr budget', async () => {
    const args = node('process.stdout.write("o".repeat(64));process.stderr.write("e".repeat(64))');
    await expect(new GitProcess().run(process.cwd(), args, {
      operation: 'noisy',
      readOnly: true,
      maxOutputBytes: 80,
      timeoutMs: 5_000,
    })).rejects.toMatchObject({ detail: { code: 'OUTPUT_LIMIT', operation: 'noisy' } });

    const truncated = await new GitProcess().run(process.cwd(), args, {
      operation: 'noisy',
      readOnly: true,
      maxOutputBytes: 80,
      timeoutMs: 5_000,
      truncateOverflow: true,
    });
    expect(truncated.truncated).toBe(true);
    expect(truncated.stdout.length + truncated.stderr.length).toBeLessThanOrEqual(80);
  });

  it('sets the noninteractive Git environment for processes Git spawns', async () => {
    const output = await new GitProcess().run(process.cwd(), alias('environment', 'process.stdout.write(`${process.env.GIT_TERMINAL_PROMPT}|${process.env.GIT_EDITOR}|${process.env.GIT_SEQUENCE_EDITOR}|${process.env.LC_ALL}`)'), {
      operation: 'environment',
      readOnly: true,
      timeoutMs: 5_000,
    });
    expect(output.stdout.toString('utf8')).toBe('0|true|true|C');
  });
});

function alias(name: string, script: string): string[] {
  return ['-c', `alias.${name}=!node -e '${script}'`, name];
}

function node(script: string): string[] {
  return [NODE_COMMAND, script];
}

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
