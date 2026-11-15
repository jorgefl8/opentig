import type { ActionJobLog, ActionJobLogLine, ActionJobLogStep } from '../../../shared/contracts';
import { stripAnsi } from './ansi';

type ReadyLog = Extract<ActionJobLog, { state: 'ready' }>;

/** A `##[group]` of a step, from its title line to its `##[endgroup]` (or the next group, or the step's end). */
export interface LogGroup {
  key: string;
  /** Index in the step's lines of its title. */
  start: number;
  /** Index after its last line. */
  end: number;
  errors: number;
}

export interface LogError { step: number; line: number; group: string | null }

export interface LogOutline {
  groups: LogGroup[][];
  /** Every error line, in order. */
  errors: LogError[];
  errorCounts: number[];
  warningCounts: number[];
}

export type LogRow =
  | { type: 'step'; key: string; step: number }
  | { type: 'omitted'; key: string; step: number; count: number }
  | { type: 'empty'; key: string; step: number }
  | { type: 'group'; key: string; step: number; line: number; group: LogGroup; open: boolean }
  | { type: 'line'; key: string; step: number; line: number; grouped: boolean };

export function outlineLog(log: ReadyLog): LogOutline {
  const groups: LogGroup[][] = [];
  const errors: LogError[] = [];
  const errorCounts: number[] = [];
  const warningCounts: number[] = [];
  log.steps.forEach((step, stepIndex) => {
    const stepGroups: LogGroup[] = [];
    let open: LogGroup | null = null;
    let errorCount = 0;
    let warningCount = 0;
    step.lines.forEach((line, index) => {
      if (line.kind === 'group') {
        if (open) open.end = index;
        open = { key: `${stepIndex}:${line.number}`, start: index, end: step.lines.length, errors: 0 };
        stepGroups.push(open);
        return;
      }
      if (line.kind === 'endgroup') {
        if (open) open.end = index + 1;
        open = null;
        return;
      }
      if (line.kind === 'error') {
        errorCount++;
        if (open) open.errors++;
        errors.push({ step: stepIndex, line: index, group: open?.key ?? null });
      } else if (line.kind === 'warning') warningCount++;
    });
    groups.push(stepGroups);
    errorCounts.push(errorCount);
    warningCounts.push(warningCount);
  });
  return { groups, errors, errorCounts, warningCounts };
}

/**
 * What opens first, for the main reason to read a log: why it failed. The failed steps
 * open, or, if none failed, those with errors; groups with an error in them open too.
 * The view starts at the first error of the first failed step, or at its last line,
 * where a failing command usually says why.
 */
export function initialLogView(log: ReadyLog, outline: LogOutline, requestedStep: number | null = null): { steps: Set<number>; groups: Set<string>; target: { step: number; line: number | null } | null } {
  const groups = new Set(outline.groups.flat().filter((group) => group.errors > 0).map((group) => group.key));
  const requested = requestedStep === null ? -1 : log.steps.findIndex((step) => step.number === requestedStep);
  if (requested >= 0) {
    const error = outline.errors.find((item) => item.step === requested);
    return { steps: new Set([requested]), groups, target: error ? { step: requested, line: error.line } : { step: requested, line: null } };
  }
  const failed = log.steps.flatMap((step, index) => step.conclusion === 'failure' ? [index] : []);
  const withErrors = log.steps.flatMap((_, index) => outline.errorCounts[index]! > 0 ? [index] : []);
  const steps = new Set(failed.length ? failed : withErrors);
  const first = failed[0] ?? withErrors[0];
  if (first === undefined) return { steps, groups, target: null };
  const error = outline.errors.find((item) => item.step === first);
  const lines = log.steps[first]!.lines;
  const last = lastShownLine(lines);
  return { steps, groups, target: error ? { step: first, line: error.line } : { step: first, line: last } };
}

function lastShownLine(lines: readonly ActionJobLogLine[]): number | null {
  for (let index = lines.length - 1; index >= 0; index--) if (lines[index]!.kind !== 'endgroup') return index;
  return null;
}

/** The rows on screen: every step's header, and the lines of the open ones, groups folded or not. */
export function logRows(log: ReadyLog, outline: LogOutline, openSteps: ReadonlySet<number>, openGroups: ReadonlySet<string>): LogRow[] {
  const rows: LogRow[] = [];
  log.steps.forEach((step, stepIndex) => {
    rows.push({ type: 'step', key: `step:${stepIndex}`, step: stepIndex });
    if (!openSteps.has(stepIndex)) return;
    if (step.omittedLines > 0) rows.push({ type: 'omitted', key: `omitted:${stepIndex}`, step: stepIndex, count: step.omittedLines });
    if (!step.lines.some((line) => line.kind !== 'endgroup')) {
      rows.push({ type: 'empty', key: `empty:${stepIndex}`, step: stepIndex });
      return;
    }
    const groups = new Map(outline.groups[stepIndex]!.map((group) => [group.start, group]));
    let index = 0;
    while (index < step.lines.length) {
      const line = step.lines[index]!;
      const group = groups.get(index);
      if (group) {
        const open = openGroups.has(group.key);
        rows.push({ type: 'group', key: `line:${stepIndex}:${index}`, step: stepIndex, line: index, group, open });
        if (!open) { index = group.end; continue; }
        for (let inner = index + 1; inner < group.end; inner++) {
          if (step.lines[inner]!.kind !== 'endgroup') rows.push({ type: 'line', key: `line:${stepIndex}:${inner}`, step: stepIndex, line: inner, grouped: true });
        }
        index = group.end;
        continue;
      }
      if (line.kind !== 'endgroup') rows.push({ type: 'line', key: `line:${stepIndex}:${index}`, step: stepIndex, line: index, grouped: false });
      index++;
    }
  });
  return rows;
}

/** A step's log as it is copied: plain text, a line each, without times, markers or colors. */
export function stepText(step: ActionJobLogStep): string {
  return step.lines.filter((line) => line.kind !== 'endgroup').map((line) => stripAnsi(line.text)).join('\n');
}
