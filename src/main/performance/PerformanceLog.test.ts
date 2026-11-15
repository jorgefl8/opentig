import { afterEach, describe, expect, it } from 'vitest';
import { describeCliProcess, notePerformance, setPerformanceSink, timedProcess, type PerformanceRecord } from './PerformanceLog';

afterEach(() => setPerformanceSink(null));

describe('performance log', () => {
  it('names a GitHub CLI process without the repository, endpoint or query it was given', () => {
    expect(describeCliProcess('/opt/tools/gh', ['pr', 'list', '-R', 'acme/secret-project', '--state', 'open'])).toEqual({ tool: 'gh', command: 'pr list' });
    expect(describeCliProcess('C:\\Tools\\GH.EXE', ['api', 'repos/acme/secret-project/actions/runs'])).toEqual({ tool: 'gh', command: 'api' });
    expect(describeCliProcess('gh', ['api', 'graphql', '-f', 'owner=acme'])).toEqual({ tool: 'gh', command: 'api graphql' });
    expect(describeCliProcess('gh', ['auth', 'token', '--user', 'someone'])).toEqual({ tool: 'gh', command: 'auth token' });
    expect(describeCliProcess('ssh', ['-G', '--', 'git@internal.example'])).toEqual({ tool: 'ssh', command: 'ssh' });
    // Any other CLI is an AI tool whose name and arguments stay out of the log.
    expect(describeCliProcess('/opt/tools/bin/private-tool', ['exec', 'prompt'])).toEqual({ tool: 'cli', command: 'cli' });
  });

  it('times a process that fails as well as one that succeeds, and measures nothing without a sink', async () => {
    let described = 0;
    const describe = () => { described += 1; return { tool: 'git' as const, command: 'status' }; };
    await timedProcess(describe, async () => 'done');
    expect(described).toBe(0);

    const records: PerformanceRecord[] = [];
    setPerformanceSink((record) => records.push(record));
    await timedProcess(describe, async () => ({ exitCode: 1 }), (result) => result.exitCode === 0);
    await expect(timedProcess(describe, async () => { throw new Error('spawn failed'); })).rejects.toThrow('spawn failed');
    expect(records).toEqual([
      { kind: 'process', tool: 'git', command: 'status', durationMs: expect.any(Number), outcome: 'failed' },
      { kind: 'process', tool: 'git', command: 'status', durationMs: expect.any(Number), outcome: 'failed' },
    ]);
  });

  it('does not let a failing sink interrupt the work it describes', () => {
    setPerformanceSink(() => { throw new Error('log is full'); });
    expect(() => notePerformance({ kind: 'cache', cache: 'github-read', resource: 'list', outcome: 'hit' })).not.toThrow();
  });
});
