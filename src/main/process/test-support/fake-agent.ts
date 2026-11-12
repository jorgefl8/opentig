import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const running: Array<() => Promise<void>> = [];
afterEach(() => Promise.all(running.splice(0).map((stop) => stop())));

/**
 * Starts an idle process the system reports under an agent's executable name,
 * such as `claude`, working in `cwd`. Linux names a process after the file it
 * was started from, so a link to Node is enough.
 */
export async function startFakeAgent(name: string, cwd: string): Promise<{ pid: number; stop(): Promise<void> }> {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'opentig-fake-agent-'));
  const executable = path.join(bin, name);
  await symlink(process.execPath, executable);
  const child = spawn(executable, ['-e', 'setInterval(() => {}, 60_000)'], { cwd, stdio: 'ignore' });
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGKILL');
    await exited;
    await rm(bin, { recursive: true, force: true });
  };
  running.push(stop);
  return { pid: child.pid!, stop };
}
