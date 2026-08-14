import { describe, expect, it } from 'vitest';
import { CliProcessRunner } from './CliProcessRunner';

describe('CliProcessRunner', () => {
  it('passes stdin and captures output', async () => {
    const runner = new CliProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { stdin: 'staged context', timeoutMs: 5_000 });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'staged context' });
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
});
