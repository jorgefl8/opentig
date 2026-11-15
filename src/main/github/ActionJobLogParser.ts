import { ACTION_JOB_LOG_LIMITS, type ActionJobLog, type ActionJobLogLine, type ActionJobLogLineKind, type ActionJobLogStep, type ActionRunStep } from '../../shared/contracts';

type Limits = { lines: number; bytes: number; lineCharacters: number; readLines?: number };

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
/** Work, roughly in characters read or items visited, done between two looks at the clock. */
const CHECK_WORK = 4_096;
/** What a line holds before its text: its time and GitHub's marker. */
const LINE_PREFIX = 64;

/**
 * Runs long work in slices: `tick` adds what was just done, and once a slice has taken
 * `SLICE_MS` it lets the server's other work through and stops if the request is gone.
 */
class Pacer {
  private work = 0;
  private sliceStart = performance.now();

  constructor(private readonly signal: AbortSignal | undefined) {}

  /** A promise to await only when the slice is over; otherwise nothing, so the work goes on without a turn. */
  tick(work = 1): Promise<void> | undefined {
    this.work += work;
    if (this.work < CHECK_WORK) return undefined;
    this.work = 0;
    return performance.now() - this.sliceStart > SLICE_MS ? this.pause() : undefined;
  }

  /** Between stages: the request may have gone while the last one ran. */
  async pause(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (this.signal?.aborted) throw this.signal.reason ?? new Error('The log is no longer needed.');
    this.sliceStart = performance.now();
  }
}

/**
 * Splits the text of a job's log, as GitHub serves it, into its steps (see `splitSteps`).
 *
 * Every stage runs in slices of `SLICE_MS`, counted by the work done, yielding to the server's
 * other work between them and stopping when `signal` aborts. Each line is cut to
 * `limits.lineCharacters` before anything else reads it, so no line, however long or full of
 * escape codes, costs more than its first characters.
 *
 * `readCut` says the text is only the start of the log: its last, possibly
 * partial, line is dropped. What is shown is bounded by `limits`: every step
 * keeps its last lines, then failed steps keep more, then steps with errors, then the rest.
 */
export async function parseActionJobLog(raw: string, job: { id: number; steps: readonly ActionRunStep[] }, readCut: boolean, options: { limits?: Limits; signal?: AbortSignal } = {}): Promise<Extract<ActionJobLog, { state: 'ready' }>> {
  const limits = options.limits ?? ACTION_JOB_LOG_LIMITS;
  const pacer = new Pacer(options.signal);
  const lines: ParsedLine[] = [];
  const markers = Object.fromEntries(MARKER_KINDS_LIST.map((kind) => [kind, [] as number[]])) as Record<MarkerKind, number[]>;
  const errors: number[] = [];
  let depth = 0;
  let displayCut = false;
  let position = raw.charCodeAt(0) === 0xFEFF ? 1 : 0;
  // So many lines would hold the server in collecting their memory however the work is sliced: past them, the log is cut.
  const readLines = limits.readLines ?? ACTION_JOB_LOG_LIMITS.readLines;
  let cut = readCut;
  while (position < raw.length) {
    if (lines.length >= readLines) { cut = true; break; }
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
    else if (depth === 0) for (const kind of MARKER_KINDS_LIST) if (STEP_MARKERS[kind](parsed)) markers[kind].push(lines.length);
    if (parsed.kind === 'error') errors.push(lines.length);
    lines.push(parsed);
    position = end + 1;
    { const wait = pacer.tick(read + 16); if (wait) await wait; }
  }
  await pacer.pause();
  const split = await splitSteps(lines, markers, errors, job.steps, cut, pacer);
  await pacer.pause();
  const kept = await allocate(split.sections, limits, pacer);
  if (kept.some((section) => section.omittedLines > 0)) displayCut = true;
  return {
    state: 'ready', jobId: job.id, steps: kept, totalLines: lines.length, readCut: cut, displayCut,
    ...(split.unsplit ? { unsplit: true as const } : {}),
    ...(split.uncertain ? { uncertain: true as const } : {}),
  };
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

interface Section { number: number | null; name: string; status: string; conclusion: string | null; lines: ParsedLine[]; hasError: boolean }

function seconds(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

type MarkerKind = 'run' | 'post' | 'complete' | 'containers' | 'stop-containers' | 'parallel';
const MARKER_KINDS_LIST: MarkerKind[] = ['run', 'post', 'complete', 'containers', 'stop-containers', 'parallel'];

/** How a step's first line looks, when GitHub writes one: a step of the workflow file starts with `##[group]Run …`. */
const STEP_MARKERS: Record<MarkerKind, (line: ParsedLine) => boolean> = {
  run: (line) => line.kind === 'group' && line.text.startsWith('Run '),
  post: (line) => line.kind === 'output' && line.text === 'Post job cleanup.',
  complete: (line) => line.kind === 'output' && /^(Evaluate and set job outputs|Cleaning up orphan processes)/.test(line.text),
  containers: (line) => line.kind === 'group' && line.text === 'Checking docker version',
  'stop-containers': (line) => line.kind === 'output' && /^(Print service container logs|Stop and remove container|Remove container network): /.test(line.text),
  // A parallel group's steps write their own lines, mixed together; the group itself writes this as they end.
  parallel: (line) => line.kind === 'output' && line.text === 'Finished waiting for background step(s).',
};
/** Marker lines a step's matching considers, the first ones in its times, so a log full of look-alike lines stays cheap. */
const MAX_CANDIDATES_PER_STEP = 64;
/** A step with a line of its own always outweighs any number of better-looking lines for the others. */
const MATCHED = 1_000;

interface Candidate { line: number; quality: number }
interface Node { line: number; score: number; position: number; quality: number; previous: Node | null }

/**
 * How surely a `##[group]Run …` line is a step's own: the default name it repeats (`Run npm test`);
 * the shape GitHub writes for a step's group, the command echoed in cyan or its `with:` and `env:`,
 * which a group a script prints doesn't have; or any. A line written in the step's own times, rather
 * than in the second around them, counts a little more, and more again when written as it started.
 */
function runQuality(lines: ParsedLine[], line: number, step: ActionRunStep): number {
  const text = lines[line]!.text;
  const next = lines[line + 1];
  const shaped = next !== undefined && (next.text.startsWith('\x1b[36;1m') || (next.kind === 'output' && (next.text === 'with:' || next.text === 'env:')));
  return (text === step.name ? 4 : shaped ? 2 : 1) + inTime(lines[line]!, step);
}

function inTime(line: ParsedLine, step: ActionRunStep): number {
  if (line.time === null) return 0.5;
  const second = Math.floor(line.time / 1000);
  const start = seconds(step.startedAt) ?? -Infinity;
  if (second < start || second > (seconds(step.completedAt) ?? Infinity)) return 0;
  // A step's first line is written as it starts, not as a long step before it ends.
  return second <= start + 1 ? 0.75 : 0.5;
}

/**
 * Which step each line belongs to. The text has no step boundaries, so the steps that ran are
 * matched, in order, to the first lines GitHub writes for them, outside any composite action's own
 * steps and within each step's times (to the second): a step of the workflow file to a
 * `##[group]Run …` line, GitHub's own post step (`Post <an earlier step>`) to `Post job cleanup.`,
 * the job's container and closing steps to the lines those start with, and a parallel group to the
 * line it writes as its steps end (the steps' own lines are mixed together, as GitHub writes them). Each line is claimed
 * once, and a step starts after the step before it. Of the ways to do that, the one that gives a
 * line of its own to the most steps wins, then the one whose lines look most like each step's own
 * (see `runQuality`), so a step never takes the line a later step needs.
 *
 * A step left without a line of its own takes the lines written in its
 * own times after the step before it ended, and nothing of its neighbours. When the log was read
 * only in part, a step that started after its last line keeps no lines. If a step of the workflow
 * file had to be placed that way, or its line was chosen among others that fit as well, the split
 * is marked `uncertain`; if most of them had to, it is not split at all (`unsplit`).
 */
async function splitSteps(lines: ParsedLine[], markers: Record<MarkerKind, number[]>, errors: number[], steps: readonly ActionRunStep[], readCut: boolean, pacer: Pacer): Promise<{ sections: Section[]; unsplit: boolean; uncertain: boolean }> {
  const hasError = (from: number, to: number) => {
    let low = 0;
    let high = errors.length;
    while (low < high) { const middle = (low + high) >> 1; if (errors[middle]! < from) low = middle + 1; else high = middle; }
    return low < errors.length && errors[low]! < to;
  };
  const sections: Section[] = steps.map((step) => ({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion, lines: [], hasError: false }));
  const ran = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.conclusion !== 'skipped' && step.startedAt !== null);
  const whole = (unsplit: boolean) => ({
    sections: lines.length ? [{ number: null, name: 'Log', status: 'completed', conclusion: ran.some(({ step }) => step.conclusion === 'failure') ? 'failure' : null, lines, hasError: errors.length > 0 }] : sections,
    unsplit: unsplit && lines.length > 0,
    uncertain: false,
  });
  if (!ran.length) return whole(false);
  const names = new Set(steps.map((step) => step.name));
  let lastSecond: number | null = null;
  for (let line = lines.length - 1; line >= 0 && lastSecond === null; line--) if (lines[line]!.time !== null) lastSecond = Math.floor(lines[line]!.time! / 1000);
  type Kind = MarkerKind | 'none';
  const kindOf = (step: ActionRunStep, position: number): Kind => {
    // Past what was read of a log cut short, a step has nothing to find.
    if (readCut && lastSecond !== null && (seconds(step.startedAt) ?? -Infinity) > lastSecond) return 'none';
    if (step.name === 'Parallel group') return 'parallel';
    if (step.name === 'Complete job' && position === ran.length - 1) return 'complete';
    if (step.name === 'Initialize containers') return 'containers';
    if (step.name === 'Stop containers') return 'stop-containers';
    if (step.name.startsWith('Post ') && names.has(step.name.slice('Post '.length))) return 'post';
    return 'run';
  };
  const kinds = ran.map(({ step }, position) => kindOf(step, position));

  // Each step's candidates: the first marker lines of its kinds within its times. A user's step that happens to share
  // the name of GitHub's container steps may also start with a `Run …` line.
  // Each kind's marker lines with the latest second written so far, so a step's first candidates are found by a search.
  const secondsOf = {} as Record<MarkerKind, number[]>;
  for (const kind of MARKER_KINDS_LIST) {
    let latest = -Infinity;
    const list: number[] = [];
    for (const line of markers[kind]) {
      const time = lines[line]!.time;
      if (time !== null) latest = Math.max(latest, Math.floor(time / 1000));
      list.push(latest);
      { const wait = pacer.tick(); if (wait) await wait; }
    }
    secondsOf[kind] = list;
  }
  const candidatesOf = async (position: number): Promise<Candidate[]> => {
    const { step } = ran[position]!;
    const kind = kinds[position]!;
    if (kind === 'none') return [];
    const startSecond = seconds(step.startedAt) ?? -Infinity;
    const endSecond = seconds(step.completedAt) ?? Infinity;
    const found: Candidate[] = [];
    // A user's step that happens to share the name of GitHub's container or post steps may also start with a
    // `Run …` line, though less surely than a step named for it.
    const alsoRun = kind === 'containers' || kind === 'stop-containers' || kind === 'post';
    for (const list of alsoRun ? [kind, 'run' as const] : [kind]) {
      const lineList = markers[list];
      const secondList = secondsOf[list];
      let low = 0;
      let high = lineList.length;
      while (low < high) { const middle = (low + high) >> 1; if (secondList[middle]! < startSecond - 1) low = middle + 1; else high = middle; }
      let taken = 0;
      for (let at = low; at < lineList.length && secondList[at]! <= endSecond + 1 && taken < MAX_CANDIDATES_PER_STEP; at++) {
        { const wait = pacer.tick(); if (wait) await wait; }
        const line = lineList[at]!;
        if (line === 0 || !within(lines[line]!, step)) continue;
        found.push({ line, quality: list !== 'run' ? 3 + inTime(lines[line]!, step) : runQuality(lines, line, step) - (kind === 'run' ? 0 : 0.75) });
        taken++;
      }
    }
    return found;
  };
  const candidates: Candidate[][] = [];
  for (let position = 0; position < ran.length; position++) candidates.push(position === 0 ? [] : await candidatesOf(position));

  // The best assignment, step by step: every node is a step's choice of line and the best way to get there.
  let nodes: Node[] = [{ line: 0, score: 0, position: 0, quality: 0, previous: null }];
  for (let position = 1; position < ran.length; position++) {
    const options = candidates[position]!;
    if (!options.length) continue;
    // The best node before each line, earlier lines first among equals.
    const best: Node[] = [];
    for (const node of nodes) {
      const previous = best.at(-1);
      best.push(previous && previous.score >= node.score ? previous : node);
      { const wait = pacer.tick(); if (wait) await wait; }
    }
    const added: Node[] = [];
    for (const candidate of options) {
      let low = 0;
      let high = nodes.length;
      while (low < high) { const middle = (low + high) >> 1; if (nodes[middle]!.line < candidate.line) low = middle + 1; else high = middle; }
      if (low === 0) continue;
      const before = best[low - 1]!;
      added.push({ line: candidate.line, score: before.score + MATCHED + candidate.quality, position, quality: candidate.quality, previous: before });
    }
    nodes = [...nodes, ...added].sort((left, right) => left.line - right.line);
  }
  // Among equals, the one that gives a line to the latest step leaves none of the later steps without.
  let end = nodes[0]!;
  for (const node of nodes) if (node.score > end.score || (node.score === end.score && node.position > end.position)) end = node;
  const chosen = new Map<number, Node>();
  for (let node: Node | null = end; node && node.previous; node = node.previous) chosen.set(node.position, node);

  // A step of the workflow file without a line of its own, or whose `Run …` line was one of several that fit as well and
  // didn't repeat its name, is a guess. A step's first line of the kind GitHub writes for it is where it starts.
  const claimed = new Set([...chosen.values()].map((node) => node.line));
  let unplaced = 0;
  let placeable = 0;
  let uncertain = false;
  for (let position = 1; position < ran.length; position++) {
    if (kinds[position] === 'none' || kinds[position] === 'complete' || kinds[position] === 'parallel') continue;
    placeable++;
    const node = chosen.get(position);
    if (!node) {
      unplaced++;
      uncertain = true;
    } else if (node.quality < 3 && candidates[position]!.some((candidate) => candidate.line !== node.line && candidate.quality === node.quality && !claimed.has(candidate.line))) {
      uncertain = true;
    }
  }
  if (placeable > 0 && unplaced * 2 > placeable) return whole(true);

  const starts = new Map<number, number>([[0, 0]]);
  for (const [position, node] of chosen) starts.set(position, node.line);
  // A step placed by its times starts after the step before it, once the step before it ended, and before the next step's line.
  let after = 0;
  for (let position = 1; position < ran.length; position++) {
    const placed = starts.get(position);
    if (placed !== undefined) { after = placed; continue; }
    const { step } = ran[position]!;
    if (kinds[position] === 'none' && readCut && lastSecond !== null && (seconds(step.startedAt) ?? -Infinity) > lastSecond) continue;
    const previous = ran[position - 1]!;
    let next = lines.length;
    for (let later = position + 1; later < ran.length; later++) {
      const line = chosen.get(later)?.line;
      if (line !== undefined) { next = line; break; }
    }
    const from = Math.max(seconds(previous.step.completedAt) ?? -Infinity, (seconds(step.startedAt) ?? Infinity) - 1) + 1;
    const until = seconds(step.completedAt) ?? Infinity;
    for (let line = after + 1; line < next; line++) {
      { const wait = pacer.tick(); if (wait) await wait; }
      const time = lines[line]!.time;
      if (time === null) continue;
      const second = Math.floor(time / 1000);
      if (second > until + 1) break;
      if (second >= from) { starts.set(position, line); after = line; break; }
    }
  }
  const ordered = [...starts].sort((left, right) => left[1] - right[1]);
  ordered.forEach(([position, line], at) => {
    const end = ordered[at + 1]?.[1] ?? lines.length;
    const section = sections[ran[position]!.index]!;
    section.lines = lines.slice(line, end);
    section.hasError = hasError(line, end);
  });
  return { sections, unsplit: false, uncertain };
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
async function allocate(sections: Section[], limits: Limits, pacer: Pacer): Promise<ActionJobLogStep[]> {
  const rank = (section: Section) => section.conclusion === 'failure' ? 0 : section.hasError ? 1 : 2;
  const order = sections.map((section, index) => ({ section, index })).sort((left, right) => rank(left.section) - rank(right.section) || left.index - right.index);
  let lineBudget = limits.lines;
  let byteBudget = limits.bytes;
  const keptCounts = new Map<number, number>();
  const take = async (section: Section, index: number, upTo: number) => {
    let kept = keptCounts.get(index) ?? 0;
    while (kept < Math.min(upTo, section.lines.length) && lineBudget > 0) {
      const text = section.lines[section.lines.length - 1 - kept]!.text;
      const cost = Buffer.byteLength(JSON.stringify(text)) + LINE_OVERHEAD;
      if (cost > byteBudget) break;
      lineBudget--;
      byteBudget -= cost;
      kept++;
      { const wait = pacer.tick(text.length + 16); if (wait) await wait; }
    }
    keptCounts.set(index, kept);
  };
  for (const { section, index } of order) await take(section, index, STEP_TAIL_LINES);
  for (const { section, index } of order) await take(section, index, Infinity);
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
