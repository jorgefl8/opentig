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
  it('is split into its steps, a composite action keeping its own lines', () => {
    const parsed = parseActionJobLog(log, { id: 7, steps }, false);
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

  it('marks errors and groups, numbers lines within their step and keeps the time apart', () => {
    const failed = parseActionJobLog(log, { id: 7, steps }, false).steps.find((section) => section.conclusion === 'failure')!;
    expect(failed.lines.map((line) => line.kind)).toEqual(['group', 'output', 'endgroup', 'output', 'error', 'error']);
    expect(failed.lines[4]).toEqual({ number: 5, time: Date.parse('2026-11-13T21:58:00.171Z'), kind: 'error', text: "src/a.ts(54,22): error TS2352: Conversion of type 'A' to type 'B' may be a mistake." });
  });

  it('puts every line in one section when GitHub lists no steps', () => {
    const parsed = parseActionJobLog('2026-11-13T21:57:38.1Z one\n2026-11-13T21:57:38.2Z two\n', { id: 1, steps: [] }, false);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]!.lines.map((line) => line.text)).toEqual(['one', 'two']);
  });

  it('drops the partial last line of a log read only in part', () => {
    const parsed = parseActionJobLog('2026-11-13T21:57:38.1Z whole\n2026-11-13T21:57:38.2Z cut sho', { id: 1, steps: [] }, true);
    expect(parsed.steps[0]!.lines.map((line) => line.text)).toEqual(['whole']);
    expect(parsed.readCut).toBe(true);
  });

  it('keeps the end of the failed step first when the log is larger than what is shown', () => {
    const body = Array.from({ length: 50 }, (_, index) => `2026-11-13T21:57:41.5Z output ${index}`);
    const big = [log.split('\n').slice(0, 16).join('\n'), ...body, ...log.split('\n').slice(16)].join('\n');
    const parsed = parseActionJobLog(big, { id: 7, steps }, false, { lines: 10, bytes: 1_000_000, lineCharacters: 2_000 });
    const failed = parsed.steps.find((section) => section.conclusion === 'failure')!;
    expect(failed.lines).toHaveLength(10);
    expect(failed.lines.at(-1)!.text).toBe('Process completed with exit code 1.');
    expect(failed.omittedLines).toBe(46);
    expect(failed.lines[0]!.number).toBe(47);
    // Nothing is left for the other steps, and each says how much it left out.
    expect(parsed.steps.find((section) => section.name === 'Set up job')).toMatchObject({ lines: [], omittedLines: 5 });
    expect(parsed.displayCut).toBe(true);
    // With room for more, every step keeps how it ended before the failed one takes the rest.
    const roomier = parseActionJobLog(big, { id: 7, steps }, false, { lines: 40, bytes: 1_000_000, lineCharacters: 2_000 });
    expect(roomier.steps.find((section) => section.name === 'Set up job')).toMatchObject({ omittedLines: 0 });
    expect(roomier.steps.find((section) => section.conclusion === 'failure')!.lines.at(-1)!.text).toBe('Process completed with exit code 1.');
  });

  it('fits in one answer of the transport however the log is written', () => {
    // As much as OpenTig reads, in lines of text that grows the most once sent: three-byte characters and escaped control codes.
    const line = `2026-11-13T21:57:41.5Z ##[error]${'€\x1b[31m"\\'.repeat(140)}\n`;
    const raw = line.repeat(Math.floor(ACTION_JOB_LOG_LIMITS.readBytes / Buffer.byteLength(line)));
    const parsed = parseActionJobLog(raw, { id: 7, steps }, true);
    expect(parsed.displayCut).toBe(true);
    expect(Buffer.byteLength(JSON.stringify({ type: 'result', id: 'x'.repeat(64), result: { ok: true, value: parsed } }))).toBeLessThan(OPEN_TIG_MAX_SERVER_MESSAGE_BYTES);
  });

  it('cuts a line longer than the limit without splitting a color code', () => {
    const line = parseLine(`2026-11-13T21:57:41.5Z ${'a'.repeat(9)}\x1b[31mred`, 10);
    expect(line).toMatchObject({ text: 'aaaaaaaaa', clipped: true });
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
