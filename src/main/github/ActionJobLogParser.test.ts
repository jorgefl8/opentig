import { describe, expect, it } from 'vitest';
import { ACTION_JOB_LOG_LIMITS, type ActionRunStep } from '../../shared/contracts';
import { OPEN_TIG_MAX_SERVER_MESSAGE_BYTES } from '../../shared/server-protocol';
import { parseActionJobLog, parseLine, sanitizeTerminalText } from './ActionJobLogParser';

const step = (number: number, name: string, startedAt: string, completedAt: string, conclusion = 'success'): ActionRunStep => (
  { number, name, status: 'completed', conclusion, startedAt: `2026-11-13T21:${startedAt}Z`, completedAt: `2026-11-13T21:${completedAt}Z` }
);

/** The shape of a real failed job: set up, a named step, a composite action, the failing step, a post step and the end. */
const steps: ActionRunStep[] = [
  step(1, 'Set up job', '57:38', '57:39'),
  step(2, 'Require a successful scope decision', '57:39', '57:39'),
  step(3, 'Run pnpm/action-setup@v4', '57:39', '57:41'),
  step(4, 'Run pnpm run typecheck', '57:41', '58:00', 'failure'),
  step(5, 'Run pnpm run lint', '58:00', '58:00', 'skipped'),
  step(19, 'Post Run pnpm/action-setup@v4', '58:00', '58:00'),
  step(21, 'Complete job', '58:00', '58:00'),
];
const log = [
  '﻿2026-11-13T21:57:38.2497964Z Current runner version: \'2.338.2\'',
  '2026-11-13T21:57:38.2521800Z ##[group]Runner Image Provisioner',
  '2026-11-13T21:57:38.2526334Z Hosted Compute Agent',
  '2026-11-13T21:57:38.2526334Z ##[endgroup]',
  '2026-11-13T21:57:39.4306613Z Complete job name: validate',
  '2026-11-13T21:57:39.5079960Z ##[group]Run node -e "process.exit(0)"',
  '2026-11-13T21:57:39.5082077Z \x1b[36;1mnode -e "process.exit(0)"\x1b[0m',
  '2026-11-13T21:57:39.5104714Z ##[endgroup]',
  '2026-11-13T21:57:39.7096787Z ##[group]Run pnpm/action-setup@v4',
  '2026-11-13T21:57:39.7111571Z ##[endgroup]',
  // A composite action's own step, in the same second the next step starts.
  '2026-11-13T21:57:41.0011571Z ##[group]Run echo inner',
  '2026-11-13T21:57:41.0011572Z inner',
  '2026-11-13T21:57:41.0011573Z ##[endgroup]',
  '2026-11-13T21:57:41.3738815Z ##[group]Run pnpm run typecheck',
  '2026-11-13T21:57:41.3739586Z \x1b[36;1mpnpm run typecheck\x1b[0m',
  '2026-11-13T21:57:41.3754850Z ##[endgroup]',
  '2026-11-13T21:57:41.3964695Z $ tsc --noEmit',
  "2026-11-13T21:58:00.1716338Z ##[error]src/a.ts(54,22): error TS2352: Conversion of type 'A' to type 'B' may be a mistake.",
  '2026-11-13T21:58:00.2442963Z ##[error]Process completed with exit code 1.',
  '2026-11-13T21:58:00.2579570Z Post job cleanup.',
  '2026-11-13T21:58:00.4087161Z Pruning is unnecessary.',
  '2026-11-13T21:58:00.6649044Z Cleaning up orphan processes',
  '',
].join('\n');

describe("a job's log", () => {
  it('is split into its steps, a composite action keeping its own lines', async () => {
    const parsed = await parseActionJobLog(log, { id: 7, steps }, false);
    const byName = Object.fromEntries(parsed.steps.map((section) => [section.name, section.lines.map((line) => line.text)]));
    expect(byName['Set up job']).toEqual(["Current runner version: '2.338.2'", 'Runner Image Provisioner', 'Hosted Compute Agent', '', 'Complete job name: validate']);
    expect(byName['Require a successful scope decision']?.[0]).toBe('Run node -e "process.exit(0)"');
    expect(byName['Run pnpm/action-setup@v4']).toContain('inner');
    expect(byName['Run pnpm run typecheck']?.[0]).toBe('Run pnpm run typecheck');
    expect(byName['Run pnpm run lint']).toEqual([]);
    expect(byName['Post Run pnpm/action-setup@v4']).toEqual(['Post job cleanup.', 'Pruning is unnecessary.']);
    expect(byName['Complete job']).toEqual(['Cleaning up orphan processes']);
    expect(parsed.totalLines).toBe(22);
    expect(parsed).toMatchObject({ readCut: false, displayCut: false });
  });

  it('marks errors and groups, numbers lines within their step and keeps the time apart', async () => {
    const failed = (await parseActionJobLog(log, { id: 7, steps }, false)).steps.find((section) => section.conclusion === 'failure')!;
    expect(failed.lines.map((line) => line.kind)).toEqual(['group', 'output', 'endgroup', 'output', 'error', 'error']);
    expect(failed.lines[4]).toEqual({ number: 5, time: Date.parse('2026-11-13T21:58:00.171Z'), kind: 'error', text: "src/a.ts(54,22): error TS2352: Conversion of type 'A' to type 'B' may be a mistake." });
  });

  it('puts every line in one section when GitHub lists no steps', async () => {
    const parsed = await parseActionJobLog('2026-11-13T21:57:38.1Z one\n2026-11-13T21:57:38.2Z two\n', { id: 1, steps: [] }, false);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]!.lines.map((line) => line.text)).toEqual(['one', 'two']);
  });

  it('drops the partial last line of a log read only in part', async () => {
    const parsed = await parseActionJobLog('2026-11-13T21:57:38.1Z whole\n2026-11-13T21:57:38.2Z cut sho', { id: 1, steps: [] }, true);
    expect(parsed.steps[0]!.lines.map((line) => line.text)).toEqual(['whole']);
    expect(parsed.readCut).toBe(true);
  });

  it('keeps the end of the failed step first when the log is larger than what is shown', async () => {
    const body = Array.from({ length: 50 }, (_, index) => `2026-11-13T21:57:41.5Z output ${index}`);
    const big = [log.split('\n').slice(0, 16).join('\n'), ...body, ...log.split('\n').slice(16)].join('\n');
    const parsed = await parseActionJobLog(big, { id: 7, steps }, false, { limits: { lines: 10, bytes: 1_000_000, lineCharacters: 2_000 } });
    const failed = parsed.steps.find((section) => section.conclusion === 'failure')!;
    expect(failed.lines).toHaveLength(10);
    expect(failed.lines.at(-1)!.text).toBe('Process completed with exit code 1.');
    expect(failed.omittedLines).toBe(46);
    expect(failed.lines[0]!.number).toBe(47);
    // Nothing is left for the other steps, and each says how much it left out.
    expect(parsed.steps.find((section) => section.name === 'Set up job')).toMatchObject({ lines: [], omittedLines: 5 });
    expect(parsed.displayCut).toBe(true);
    // With room for more, every step keeps how it ended before the failed one takes the rest.
    const roomier = await parseActionJobLog(big, { id: 7, steps }, false, { limits: { lines: 40, bytes: 1_000_000, lineCharacters: 2_000 } });
    expect(roomier.steps.find((section) => section.name === 'Set up job')).toMatchObject({ omittedLines: 0 });
    expect(roomier.steps.find((section) => section.conclusion === 'failure')!.lines.at(-1)!.text).toBe('Process completed with exit code 1.');
  });

  it('fits in one answer of the transport however the log is written', async () => {
    // As much as OpenTig reads, in lines of text that grows the most once sent: three-byte characters and escaped control codes.
    const line = `2026-11-13T21:57:41.5Z ##[error]${'€\x1b[31m"\\'.repeat(140)}\n`;
    const raw = line.repeat(Math.floor(ACTION_JOB_LOG_LIMITS.readBytes / Buffer.byteLength(line)));
    const parsed = await parseActionJobLog(raw, { id: 7, steps }, true);
    expect(parsed.displayCut).toBe(true);
    expect(Buffer.byteLength(JSON.stringify({ type: 'result', id: 'x'.repeat(64), result: { ok: true, value: parsed } }))).toBeLessThan(OPEN_TIG_MAX_SERVER_MESSAGE_BYTES);
  });

  it('cuts a line longer than the limit without splitting a color code', () => {
    const line = parseLine(`2026-11-13T21:57:41.5Z ${'a'.repeat(9)}\x1b[31mred`, 10);
    expect(line).toMatchObject({ text: 'aaaaaaaaa', clipped: true });
  });
});

/** A job with service containers, as a recent runner writes it: a composite action's own steps sit between `##[start-action]` and `##[end-action]`. */
const containerSteps: ActionRunStep[] = [
  step(1, 'Set up job', '42:42', '42:43'),
  step(2, 'Initialize containers', '42:43', '42:54'),
  step(3, 'Run actions/checkout@v4', '42:54', '42:56'),
  step(4, 'Run ./.github/actions/go-setup', '42:56', '43:33'),
  step(5, 'Run make test', '43:33', '54:16', 'failure'),
  step(6, 'Post coverage comment', '54:16', '54:16'),
  step(8, 'Post Run ./.github/actions/go-setup', '54:16', '54:16'),
  step(9, 'Post Run actions/checkout@v4', '54:16', '54:16'),
  step(10, 'Stop containers', '54:16', '54:17'),
  step(11, 'Complete job', '54:17', '54:17'),
];
const containerLog = [
  '2026-11-13T21:42:42.7Z Current runner version: \'2.338.2\'',
  '2026-11-13T21:42:43.2Z Complete job name: test-pgsql',
  '2026-11-13T21:42:43.3Z ##[group]Checking docker version',
  '2026-11-13T21:42:43.4Z ##[endgroup]',
  '2026-11-13T21:42:44.5Z ##[group]Starting pgsql service container',
  '2026-11-13T21:42:49.2Z ##[endgroup]',
  '2026-11-13T21:42:55.0Z ##[group]Run actions/checkout@v4',
  '2026-11-13T21:42:56.0Z ##[endgroup]',
  '2026-11-13T21:42:56.8Z ##[group]Run ./.github/actions/go-setup',
  '2026-11-13T21:42:56.8Z ##[endgroup]',
  '2026-11-13T21:42:56.9Z ##[start-action display=Run actions/setup-go@v5;id=__self.setup-go]',
  '2026-11-13T21:42:56.9Z ##[group]Run actions/setup-go@v5',
  '2026-11-13T21:42:56.9Z ##[endgroup]',
  '2026-11-13T21:43:33.2Z ##[end-action id=__self.setup-go;outcome=success;conclusion=success;duration_ms=36000]',
  '2026-11-13T21:43:33.3Z ##[group]Run make test',
  '2026-11-13T21:43:33.3Z ##[endgroup]',
  '2026-11-13T21:54:15.9Z ##[error]Process completed with exit code 2.',
  '2026-11-13T21:54:16.0Z ##[group]Run gh pr comment --body-file coverage.md',
  '2026-11-13T21:54:16.0Z ##[endgroup]',
  '2026-11-13T21:54:16.0Z Post job cleanup.',
  '2026-11-13T21:54:16.0Z ##[start-action display=Run actions/setup-go@v5;id=__post.setup-go]',
  '2026-11-13T21:54:16.0Z Post job cleanup.',
  '2026-11-13T21:54:16.1Z ##[end-action id=__post.setup-go;outcome=success;conclusion=success;duration_ms=128]',
  '2026-11-13T21:54:16.1Z Post job cleanup.',
  '2026-11-13T21:54:16.2Z [command]/usr/bin/git version',
  '2026-11-13T21:54:16.4Z Print service container logs: pgsql',
  '2026-11-13T21:54:16.4Z Stop and remove container: pgsql',
  '2026-11-13T21:54:17.0Z Cleaning up orphan processes',
  '',
].join('\n');

describe('steps of a job with containers', () => {
  it('gives each step its own lines, the failed step its error and nothing of the next step', async () => {
    const parsed = await parseActionJobLog(containerLog, { id: 7, steps: containerSteps }, false);
    expect(parsed.unsplit).toBeUndefined();
    const byName = Object.fromEntries(parsed.steps.map((section) => [section.name, section.lines.map((line) => line.text)]));
    expect(byName['Initialize containers']?.[0]).toBe('Checking docker version');
    expect(byName['Run actions/checkout@v4']?.[0]).toBe('Run actions/checkout@v4');
    expect(byName['Run ./.github/actions/go-setup']).toContain('Run actions/setup-go@v5');
    expect(byName['Run make test']).toEqual(['Run make test', '', 'Process completed with exit code 2.']);
    expect(parsed.steps.filter((section) => section.lines.some((line) => line.kind === 'error')).map((section) => section.name)).toEqual(['Run make test']);
    // A step the user named "Post …" is a step of the file, not GitHub's cleanup after an earlier one.
    expect(byName['Post coverage comment']).toEqual(['Run gh pr comment --body-file coverage.md', '']);
    // A composite action's own cleanup stays with its post step.
    expect(byName['Post Run ./.github/actions/go-setup']?.filter((text) => text === 'Post job cleanup.')).toHaveLength(2);
    expect(byName['Post Run actions/checkout@v4']).toEqual(['Post job cleanup.', '/usr/bin/git version']);
    expect(byName['Stop containers']).toEqual(['Print service container logs: pgsql', 'Stop and remove container: pgsql']);
    expect(byName['Complete job']).toEqual(['Cleaning up orphan processes']);
  });

  it('takes a step without a line of its own from its times, and nothing written before it started', async () => {
    const withoutDockerGroup = containerLog.replace('##[group]Checking docker version', 'Checking docker version');
    const parsed = await parseActionJobLog(withoutDockerGroup, { id: 7, steps: containerSteps }, false);
    const byName = Object.fromEntries(parsed.steps.map((section) => [section.name, section.lines.map((line) => line.text)]));
    // Lines in the second the set-up ended stay with it; the service starting later is the containers'.
    expect(byName['Set up job']).toContain('Checking docker version');
    expect(byName['Initialize containers']).toEqual(['Starting pgsql service container', '']);
    expect(byName['Run actions/checkout@v4']?.[0]).toBe('Run actions/checkout@v4');
  });

  it('shows the log whole, and says so, when a step that ran has no line to start from', async () => {
    const parsed = await parseActionJobLog(containerLog.replace('##[group]Run make test', 'make test'), { id: 7, steps: containerSteps }, false);
    expect(parsed.unsplit).toBe(true);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]).toMatchObject({ number: null, name: 'Log', conclusion: 'failure' });
    expect(parsed.steps[0]!.lines).toHaveLength(28);
  });
});

describe('a hostile log', () => {
  /** The longest the event loop waited for a turn while `work` ran. */
  async function longestStall(work: () => Promise<unknown>): Promise<number> {
    let longest = 0;
    let last = performance.now();
    let running = true;
    const tick = () => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      if (running) setImmediate(tick);
    };
    setImmediate(tick);
    await work();
    running = false;
    longest = Math.max(longest, performance.now() - last);
    return longest;
  }
  const sixteen = ACTION_JOB_LOG_LIMITS.readBytes;

  it.each([
    ['one line of unfinished escapes', () => `2026-11-13T21:57:41.5Z ${'\x1b['.repeat(sixteen / 2)}`],
    ['one line of color codes', () => `2026-11-13T21:57:41.5Z ${'\x1b[1m'.repeat(sixteen / 4)}`],
    ['many short lines', () => '2026-11-13T21:57:41.5Z output of a step\n'.repeat(Math.floor(sixteen / 40))],
  ])('keeps the server answering while %s is read', async (_label, make) => {
    const raw = make();
    let parsed: Awaited<ReturnType<typeof parseActionJobLog>> | null = null;
    const stall = await longestStall(async () => { parsed = await parseActionJobLog(raw, { id: 7, steps }, false); });
    expect(parsed).not.toBeNull();
    expect(stall).toBeLessThan(100);
  }, 30_000);

  it('stops when the read is no longer needed', async () => {
    const controller = new AbortController();
    const reading = parseActionJobLog('2026-11-13T21:57:41.5Z line\n'.repeat(400_000), { id: 7, steps }, false, { signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await expect(reading).rejects.toThrow('cancelled');
  });
});

describe('text from a log', () => {
  it('keeps color codes and drops every other escape sequence', () => {
    expect(sanitizeTerminalText('\x1b[1;31mFAIL\x1b[0m \x1b[2J\x1b[Hdone\x1b]0;title\x07')).toBe('\x1b[1;31mFAIL\x1b[0m done');
  });

  it('keeps the text of a terminal link but not where it points', () => {
    expect(sanitizeTerminalText('see \x1b]8;;https://example.invalid/x\x1b\\the docs\x1b]8;;\x1b\\ now')).toBe('see the docs now');
  });

  it('drops control characters and what a carriage return overwrote', () => {
    expect(sanitizeTerminalText('progress 10%\rprogress 100%\x07\x00\x08')).toBe('progress 100%');
    expect(sanitizeTerminalText('a\x9b31mb\x1bPq#0;2;0;0;0\x1b\\c')).toBe('abc');
  });

  it('leaves markup as the text it is', () => {
    const line = parseLine('2026-11-13T21:57:41.5Z ##[error]<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(line).toMatchObject({ kind: 'error', text: '<img src=x onerror=alert(1)><script>alert(1)</script>' });
  });

  it('reads `[command]` lines and keeps a line without a time', () => {
    expect(parseLine('2026-11-13T21:57:41.5Z [command]/usr/bin/git version')).toMatchObject({ kind: 'command', text: '/usr/bin/git version' });
    expect(parseLine('no time here')).toMatchObject({ time: null, kind: 'output', text: 'no time here' });
  });
});
