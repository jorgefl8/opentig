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

/** How long the parse runs before letting the server's other work through: every client shares its one thread. */
const SLICE_MS = 8;
/** What a line holds before its text: its time and GitHub's marker. */
const LINE_PREFIX = 64;

/**
 * Splits the text of a job's log, as GitHub serves it, into its steps (see `splitSteps`).
 *
 * It runs in slices of `SLICE_MS`, yielding to the server's other work between them and
 * stopping when `signal` aborts. Each line is cut to `limits.lineCharacters` before
 * anything else reads it, so no line, however long or full of escape codes, costs more
 * than its first characters.
 *
 * `readCut` says the text is only the start of the log: its last, possibly
 * partial, line is dropped. What is shown is bounded by `limits`: every step
 * keeps its last lines, then failed steps keep more, then steps with errors, then the rest.
 */
export async function parseActionJobLog(raw: string, job: { id: number; steps: readonly ActionRunStep[] }, readCut: boolean, options: { limits?: Limits; signal?: AbortSignal } = {}): Promise<Extract<ActionJobLog, { state: 'ready' }>> {
  const limits = options.limits ?? ACTION_JOB_LOG_LIMITS;
  const lines: ParsedLine[] = [];
  const nested: boolean[] = [];
  let depth = 0;
  let displayCut = false;
  let position = raw.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let sliceStart = performance.now();
  while (position < raw.length) {
    const newline = raw.indexOf('\n', position);
    // The last line of a log read only in part may itself be cut.
    if (newline < 0 && readCut) break;
    const end = newline < 0 ? raw.length : newline;
    const read = Math.min(end - position, limits.lineCharacters + LINE_PREFIX);
    const parsed = parseLine(raw.slice(position, position + read), limits.lineCharacters, read < end - position);
    if (parsed.clipped) displayCut = true;
    // A composite action's own steps sit between these lines: their `Run …` and cleanup lines are not the job's steps.
    if (parsed.kind === 'output' && parsed.text.startsWith('##[start-action ')) depth++;
    else if (parsed.kind === 'output' && parsed.text.startsWith('##[end-action ')) depth = Math.max(0, depth - 1);
    lines.push(parsed);
    nested.push(depth > 0);
    position = end + 1;
    if ((lines.length & 255) === 0 && performance.now() - sliceStart > SLICE_MS) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('The log is no longer needed.');
      sliceStart = performance.now();
    }
  }
  const split = splitSteps(lines, nested, job.steps);
  const kept = allocate(split.sections, limits);
  if (kept.some((section) => section.omittedLines > 0)) displayCut = true;
  return { state: 'ready', jobId: job.id, steps: kept, totalLines: lines.length, readCut, displayCut, ...(split.unsplit ? { unsplit: true as const } : {}) };
}

/**
 * One line: its time taken off, GitHub's marker read, cut to `maxCharacters`, and only then
 * cleaned to the escape codes that color text. `longer` says the line went on past `line`.
 */
export function parseLine(line: string, maxCharacters: number = ACTION_JOB_LOG_LIMITS.lineCharacters, longer = false): ParsedLine {
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
  let clipped = longer;
  if (text.length > maxCharacters) {
    text = text.slice(0, maxCharacters);
    clipped = true;
  }
  // Never end inside a surrogate pair; a color code cut short is dropped with the other escapes.
  if (clipped && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return { time, kind, text: sanitizeTerminalText(text), clipped };
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

interface Section { number: number | null; name: string; status: string; conclusion: string | null; lines: ParsedLine[] }

function seconds(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

type StepKind = 'run' | 'post' | 'complete' | 'containers' | 'stop-containers';

/** How a step's first line looks, when GitHub writes one: a step of the workflow file starts with `##[group]Run …`. */
const STEP_MARKERS: Record<StepKind, (line: ParsedLine) => boolean> = {
  run: (line) => line.kind === 'group' && line.text.startsWith('Run '),
  post: (line) => line.kind === 'output' && line.text === 'Post job cleanup.',
  complete: (line) => line.kind === 'output' && /^(Evaluate and set job outputs|Cleaning up orphan processes)/.test(line.text),
  containers: (line) => line.kind === 'group' && line.text === 'Checking docker version',
  'stop-containers': (line) => line.kind === 'output' && /^(Print service container logs|Stop and remove container|Remove container network): /.test(line.text),
};

/**
 * Which step each line belongs to. The text has no step boundaries, so each step that ran is
 * matched to the first line GitHub writes for it, outside any composite action's own steps,
 * within the step's times (to the second): a step of the workflow file to its `##[group]Run …`
 * line, preferring the one that repeats a default name such as `Run npm test` and never taking
 * the one of a later step's default name; GitHub's own post step (`Post <an earlier step>`) to
 * `Post job cleanup.`; and the job's container and closing steps to the lines those start with.
 * Each line is claimed once, in order: a step starts after the step before it. The first step
 * starts at the first line. A container or closing step whose line isn't found takes the lines
 * written within its own times, after the step before it ended, and nothing before or after.
 *
 * If a step of the workflow file that ran can't be placed, the log can't be split with
 * confidence: it is returned whole, marked `unsplit`, rather than split wrongly.
 */
function splitSteps(lines: ParsedLine[], nested: boolean[], steps: readonly ActionRunStep[]): { sections: Section[]; unsplit: boolean } {
  const sections: Section[] = steps.map((step) => ({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion, lines: [] }));
  const ran = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.conclusion !== 'skipped' && step.startedAt !== null);
  const whole = (unsplit: boolean) => ({
    sections: lines.length ? [{ number: null, name: 'Log', status: 'completed', conclusion: ran.some(({ step }) => step.conclusion === 'failure') ? 'failure' : null, lines }] : sections,
    unsplit: unsplit && lines.length > 0,
  });
  if (!ran.length) return whole(false);
  const names = new Set(steps.map((step) => step.name));
  const kindOf = (step: ActionRunStep, position: number): StepKind => {
    if (step.name === 'Complete job' && position === ran.length - 1) return 'complete';
    if (step.name === 'Initialize containers') return 'containers';
    if (step.name === 'Stop containers') return 'stop-containers';
    if (step.name.startsWith('Post ') && names.has(step.name.slice('Post '.length))) return 'post';
    return 'run';
  };
  // The lines that can start a step, by kind, found once: the matching below only walks these.
  const markers = Object.fromEntries(Object.keys(STEP_MARKERS).map((kind) => [kind, [] as number[]])) as Record<StepKind, number[]>;
  lines.forEach((line, index) => {
    if (nested[index]) return;
    for (const kind of Object.keys(STEP_MARKERS) as StepKind[]) if (STEP_MARKERS[kind](line)) markers[kind].push(index);
  });
  const starts = new Map<number, number>([[ran[0]!.index, 0]]);
  const timed: number[] = [];
  let cursor = 0;
  for (let position = 1; position < ran.length; position++) {
    const { step, index } = ran[position]!;
    const kind = kindOf(step, position);
    const later = new Set(ran.slice(position + 1).map((item) => item.step.name));
    const found = findMarker(lines, markers[kind], cursor, step, kind === 'run' ? later : null);
    if (found !== null) {
      starts.set(index, found);
      cursor = found;
    } else if (kind === 'run' || kind === 'post') {
      return whole(true);
    } else timed.push(position);
  }
  // A step placed by its times starts after the step before it ended, and before the next step's line.
  for (const position of timed) {
    const { step, index } = ran[position]!;
    const previous = ran[position - 1]!;
    const after = Math.max(...ran.slice(0, position).map((item) => starts.get(item.index) ?? 0));
    const next = ran.slice(position + 1).map((item) => starts.get(item.index)).find((line) => line !== undefined) ?? lines.length;
    const from = Math.max(seconds(previous.step.completedAt) ?? -Infinity, (seconds(step.startedAt) ?? Infinity) - 1) + 1;
    const until = seconds(step.completedAt) ?? Infinity;
    for (let line = after + 1; line < next; line++) {
      const time = lines[line]!.time;
      if (time === null) continue;
      const second = Math.floor(time / 1000);
      if (second > until + 1) break;
      if (second >= from) { starts.set(index, line); break; }
    }
  }
  const ordered = [...starts].sort((left, right) => left[1] - right[1]);
  ordered.forEach(([index, line], position) => {
    const end = ordered[position + 1]?.[1] ?? lines.length;
    sections[index]!.lines = lines.slice(line, end);
  });
  return { sections, unsplit: false };
}

/** Marker lines a step's search looks at before giving up, so a log full of look-alike lines stays cheap. */
const MAX_MARKERS_PER_STEP = 2_000;

/**
 * The first of `candidates` after `cursor` within the step's times: the one that repeats the step's
 * own name if there is one, otherwise the first that isn't a later step's (`later`, for `Run …` lines).
 */
function findMarker(lines: ParsedLine[], candidates: number[], cursor: number, step: ActionRunStep, later: Set<string> | null): number | null {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candidates[middle]! <= cursor) low = middle + 1;
    else high = middle;
  }
  const endSecond = seconds(step.completedAt);
  let first: number | null = null;
  for (let at = low; at < candidates.length && at < low + MAX_MARKERS_PER_STEP; at++) {
    const line = lines[candidates[at]!]!;
    if (line.time !== null && endSecond !== null && Math.floor(line.time / 1000) > endSecond + 1) break;
    if (!within(line, step)) continue;
    if (later && line.text === step.name) return candidates[at]!;
    if (first === null && !later?.has(line.text)) first = candidates[at]!;
    if (!later) return first;
  }
  return first;
}

/** Whether a line was written within a step's times, to the second GitHub gives them; a line without a time could be. */
function within(line: ParsedLine, step: ActionRunStep): boolean {
  if (line.time === null) return true;
  const second = Math.floor(line.time / 1000);
  const startSecond = seconds(step.startedAt);
  const endSecond = seconds(step.completedAt);
  return (startSecond === null || second >= startSecond - 1) && (endSecond === null || second <= endSecond + 1);
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
