import { ACTION_JOB_LOG_LIMITS, type ActionJobLog, type ActionJobLogLine, type ActionJobLogLineKind, type ActionJobLogStep, type ActionRunStep } from '../../shared/contracts';

type Limits = { lines: number; bytes: number; lineCharacters: number };

interface ParsedLine { time: number | null; kind: ActionJobLogLineKind; text: string; clipped: boolean }

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?/;
const MARKER = /^##\[(group|endgroup|error|warning|notice|debug|command|section)\]/;
const MARKER_KINDS: Record<string, ActionJobLogLineKind> = {
  group: 'group', endgroup: 'endgroup', error: 'error', warning: 'warning', notice: 'notice', debug: 'debug', command: 'command', section: 'output',
};
/** What JSON adds to each line around its text, in bytes, near enough to keep the answer within the transport's size. */
const LINE_OVERHEAD = 56;

/**
 * Splits the text of a job's log, as GitHub serves it, into its steps.
 *
 * The log has no step markers: each step starts with the `##[group]Run …` line
 * GitHub writes for it, a post step with `Post job cleanup.`, and the job's last
 * step with `Cleaning up orphan processes`. Steps are matched to those lines in
 * order, within the times GitHub gives each step (to the second), preferring the
 * line that repeats the step's own name. Lines before the second step belong to
 * the first; a step whose start isn't found keeps no lines, and its output stays
 * with the step before it.
 *
 * `readCut` says the text is only the start of the log: its last, possibly
 * partial, line is dropped. What is shown is bounded by `limits`: every step
 * keeps its last lines, then failed steps keep more, then steps with errors, then the rest.
 */
export function parseActionJobLog(raw: string, job: { id: number; steps: readonly ActionRunStep[] }, readCut: boolean, limits: Limits = ACTION_JOB_LOG_LIMITS): Extract<ActionJobLog, { state: 'ready' }> {
  const rawLines = raw.replace(/^﻿/, '').split('\n');
  if (rawLines.at(-1) === '' || readCut) rawLines.pop();
  let displayCut = false;
  const lines = rawLines.map((line) => {
    const parsed = parseLine(line, limits.lineCharacters);
    if (parsed.clipped) displayCut = true;
    return parsed;
  });
  const sections = splitSteps(lines, job.steps);
  const kept = allocate(sections, limits);
  if (kept.some((section) => section.omittedLines > 0)) displayCut = true;
  return { state: 'ready', jobId: job.id, steps: kept, totalLines: lines.length, readCut, displayCut };
}

/** One line: its time taken off, GitHub's marker read, and only the escape codes that color text kept. */
export function parseLine(line: string, maxCharacters: number = ACTION_JOB_LOG_LIMITS.lineCharacters): ParsedLine {
  let text = line.endsWith('\r') ? line.slice(0, -1) : line;
  let time: number | null = null;
  const stamp = TIMESTAMP.exec(text);
  if (stamp) {
    const parsed = Date.parse(stamp[1]!);
    time = Number.isFinite(parsed) ? parsed : null;
    text = text.slice(stamp[0].length);
  }
  let kind: ActionJobLogLineKind = 'output';
  const marker = MARKER.exec(text);
  if (marker) {
    kind = MARKER_KINDS[marker[1]!] ?? 'output';
    text = text.slice(marker[0].length);
  } else if (text.startsWith('[command]')) {
    kind = 'command';
    text = text.slice('[command]'.length);
  }
  text = sanitizeTerminalText(text);
  let clipped = false;
  if (text.length > maxCharacters) {
    text = clipText(text, maxCharacters);
    clipped = true;
  }
  return { time, kind, text, clipped };
}

/**
 * Keeps what a terminal would print, as text: color codes (SGR, `ESC [ … m`) stay for
 * the viewer to style; every other escape sequence, such as cursor movement, a title
 * or a link (OSC 8, whose visible text stays), and other control characters go.
 * A carriage return in the middle of a line leaves what was written after it.
 */
export function sanitizeTerminalText(value: string): string {
  let text = value;
  const carriage = text.lastIndexOf('\r');
  if (carriage >= 0) text = text.slice(carriage + 1);
  // OSC: ESC ] … (BEL | ESC \), and its 8-bit form.
  // eslint-disable-next-line no-control-regex -- terminal escape codes are what is being removed.
  text = text.replace(/(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?/g, '');
  // CSI: keep only SGR with numeric parameters.
  // eslint-disable-next-line no-control-regex -- terminal escape codes are what is being removed.
  text = text.replace(/(?:\x1b\[|\x9b)([0-?]*)([ -/]*)([@-~])?/g, (match: string, parameters: string, intermediates: string, final: string | undefined) => (
    final === 'm' && !intermediates && /^[0-9;]*$/.test(parameters) && match.startsWith('\x1b') ? `\x1b[${parameters}m` : ''
  ));
  // DCS, SOS, PM, APC strings, then any other escape, then other control characters.
  // eslint-disable-next-line no-control-regex -- terminal escape codes are what is being removed.
  text = text.replace(/\x1b[PX^_][^\x1b]*(?:\x1b\\)?/g, '');
  // eslint-disable-next-line no-control-regex -- terminal escape codes are what is being removed.
  text = text.replace(/\x1b(?!\[[0-9;]*m)[\s\S]?/g, '');
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g, '');
}

function clipText(text: string, maxCharacters: number): string {
  let clipped = text.slice(0, maxCharacters);
  // Never end inside a surrogate pair or a color code.
  if (/[\uD800-\uDBFF]$/.test(clipped)) clipped = clipped.slice(0, -1);
  // eslint-disable-next-line no-control-regex -- terminal escape codes are what is being removed.
  return clipped.replace(/\x1b(?:\[[0-9;]*)?$/, '');
}

interface Section { number: number | null; name: string; status: string; conclusion: string | null; lines: ParsedLine[] }

function seconds(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function splitSteps(lines: ParsedLine[], steps: readonly ActionRunStep[]): Section[] {
  const sections: Section[] = steps.map((step) => ({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion, lines: [] }));
  const ran = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.conclusion !== 'skipped' && step.startedAt !== null);
  if (!ran.length) {
    return lines.length ? [{ number: null, name: 'Log', status: 'completed', conclusion: null, lines }] : sections;
  }
  const starts: Array<{ index: number; line: number }> = [{ index: ran[0]!.index, line: 0 }];
  let cursor = 0;
  for (const { step, index } of ran.slice(1)) {
    const found = findStepStart(lines, step, cursor + 1);
    if (found === null) continue;
    starts.push({ index, line: found });
    cursor = found;
  }
  starts.forEach((start, position) => {
    const end = starts[position + 1]?.line ?? lines.length;
    sections[start.index]!.lines = lines.slice(start.line, end);
  });
  return sections;
}

function findStepStart(lines: ParsedLine[], step: ActionRunStep, from: number): number | null {
  const startSecond = seconds(step.startedAt);
  const endSecond = seconds(step.completedAt);
  const within = (line: ParsedLine) => {
    if (line.time === null) return true;
    const second = Math.floor(line.time / 1000);
    return (startSecond === null || second >= startSecond - 1) && (endSecond === null || second <= endSecond + 1);
  };
  const isStart = step.name.startsWith('Post ')
    ? (line: ParsedLine) => line.kind === 'output' && line.text === 'Post job cleanup.'
    : step.name === 'Complete job'
      ? (line: ParsedLine) => line.kind === 'output' && /^(Evaluate and set job outputs|Cleaning up orphan processes)/.test(line.text)
      : (line: ParsedLine) => line.kind === 'group' && line.text.startsWith('Run ');
  let first: number | null = null;
  for (let index = from; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.time !== null && endSecond !== null && Math.floor(line.time / 1000) > endSecond + 1) break;
    if (!isStart(line) || !within(line)) continue;
    // The line that names the step itself is its start, even after a nested step's line.
    if (line.kind === 'group' && line.text === step.name) return index;
    first ??= index;
  }
  return first;
}

/** Lines from the end of every step kept before any step gets more, so each still shows how it ended. */
const STEP_TAIL_LINES = 20;

/**
 * Keeps the end of each step within the limits: first the last lines of every step (failed steps,
 * then steps with errors, then the rest), then as much more of each, in the same order.
 */
function allocate(sections: Section[], limits: Limits): ActionJobLogStep[] {
  const rank = (section: Section) => section.conclusion === 'failure' ? 0 : section.lines.some((line) => line.kind === 'error') ? 1 : 2;
  const order = sections.map((section, index) => ({ section, index })).sort((left, right) => rank(left.section) - rank(right.section) || left.index - right.index);
  let lineBudget = limits.lines;
  let byteBudget = limits.bytes;
  const keptCounts = new Map<number, number>();
  const take = (section: Section, index: number, upTo: number) => {
    let kept = keptCounts.get(index) ?? 0;
    while (kept < Math.min(upTo, section.lines.length) && lineBudget > 0) {
      const cost = Buffer.byteLength(JSON.stringify(section.lines[section.lines.length - 1 - kept]!.text)) + LINE_OVERHEAD;
      if (cost > byteBudget) break;
      lineBudget--;
      byteBudget -= cost;
      kept++;
    }
    keptCounts.set(index, kept);
  };
  for (const { section, index } of order) take(section, index, STEP_TAIL_LINES);
  for (const { section, index } of order) take(section, index, Infinity);
  return sections.map((section, index) => {
    const kept = keptCounts.get(index) ?? 0;
    const omitted = section.lines.length - kept;
    const lines: ActionJobLogLine[] = section.lines.slice(omitted).map((line, offset) => ({
      number: omitted + offset + 1,
      time: line.time,
      kind: line.kind,
      text: line.text,
      ...(line.clipped ? { clipped: true as const } : {}),
    }));
    return { number: section.number, name: section.name, status: section.status, conclusion: section.conclusion, lines, omittedLines: omitted };
  });
}
