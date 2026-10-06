import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliEnvironment, readUserEnvironment } from './CliEnvironment';

const query = vi.hoisted(() => vi.fn<(command: string, args: string[], options: { timeout: number }) => Promise<unknown>>());
vi.mock('execa', () => ({ execa: query }));

const host = { platform: 'win32' as const, home: 'C:\\Fixture', env: { SystemRoot: 'C:\\Windows', PATH: 'D:\\Inherited' } };

function simulateQuery(startupMs?: number) {
  query.mockImplementation((_command, _args, options) => new Promise((resolve) => {
    const finished = startupMs === undefined ? undefined : setTimeout(() => {
      clearTimeout(deadline);
      resolve({ exitCode: 0, timedOut: false, isMaxBuffer: false, stdout: JSON.stringify({
        Machine: { Path: 'C:\\Windows\\System32' }, User: { Path: 'D:\\Tools', TOKEN: 'private_fixture_token' },
      }) });
    }, startupMs);
    const deadline = setTimeout(() => {
      clearTimeout(finished);
      resolve({ exitCode: undefined, timedOut: true, isMaxBuffer: false, stdout: 'private_fixture_output', stderr: 'private_fixture_error' });
    }, options.timeout);
  }));
}

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('bounded Windows environment queries', () => {
  it('imports persisted locations after a slow cold PowerShell startup without importing credentials', async () => {
    vi.useFakeTimers();
    simulateQuery(6_000);
    const observed = readUserEnvironment(host).then((env) => ({ env }), (error: Error) => ({ error }));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await observed).toEqual({ env: { PATH: 'C:\\Windows\\System32;D:\\Tools' } });
  });

  it('times out a hanging Windows query and reports a safe inherited-environment fallback', async () => {
    vi.useFakeTimers();
    simulateQuery();
    const environment = new CliEnvironment(host);
    let completed = false;
    const pending = environment.get().then((result) => { completed = true; return result; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.env.PATH).toBe('D:\\Inherited');
    expect(result.warning).toContain('Could not refresh the user environment');
    expect(JSON.stringify(result)).not.toContain('private_fixture');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps the POSIX shell query bounded to five seconds', async () => {
    vi.useFakeTimers();
    simulateQuery();
    const observed = readUserEnvironment({ platform: 'linux', home: '/fixture', env: { PATH: '/bin' }, shell: '/bin/bash' })
      .then(() => 'unexpected success', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await observed).toBe('Shell environment query failed');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
