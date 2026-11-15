/**
 * What `OPENTIG_PERF_LOG=1` adds to the server log about the work behind a
 * request: how long each `git` and `gh` process ran, and whether a read was
 * answered from what the server already had. Records carry names fixed in the
 * code and numbers only: never arguments, paths, repository names or output.
 */
export type PerformanceRecord =
  | { kind: 'process'; tool: 'git' | 'gh' | 'ssh' | 'cli'; command: string; operation?: string; durationMs: number; outcome: 'ok' | 'failed' }
  | { kind: 'cache'; cache: string; resource: string; outcome: 'hit' | 'miss' };

let sink: ((record: PerformanceRecord) => void) | null = null;

/** The server installs a sink when performance logging is on; without one, nothing is measured. */
export function setPerformanceSink(next: ((record: PerformanceRecord) => void) | null): void {
  sink = next;
}

export function performanceLogging(): boolean {
  return sink !== null;
}

export function notePerformance(record: PerformanceRecord): void {
  // Diagnostics must not interrupt the work they describe.
  try { sink?.(record); } catch { /* ignored */ }
}

/** Runs `work` and, with logging on, notes how long its process took. */
export async function timedProcess<T>(
  describe: () => Pick<Extract<PerformanceRecord, { kind: 'process' }>, 'tool' | 'command' | 'operation'>,
  work: () => Promise<T>,
  succeeded: (value: T) => boolean = () => true,
): Promise<T> {
  if (!sink) return work();
  const startedAt = performance.now();
  let outcome: 'ok' | 'failed' = 'failed';
  try {
    const value = await work();
    if (succeeded(value)) outcome = 'ok';
    return value;
  } finally {
    notePerformance({ kind: 'process', ...describe(), durationMs: performance.now() - startedAt, outcome });
  }
}

/** Keeps a label only when it is a plain name, so nothing else can reach the log through one. */
export function performanceLabel(value: string | undefined, fallback: string): string {
  return value && /^[a-z0-9-]{1,64}$/i.test(value) ? value : fallback;
}

const GH_GROUPS = new Set(['pr', 'auth', 'release', 'run', 'workflow', 'repo']);

/**
 * Names a CLI process without its arguments. A `gh api` call keeps only whether
 * it is GraphQL, since its next argument is an endpoint naming the repository.
 */
export function describeCliProcess(executable: string, args: readonly string[]): { tool: 'gh' | 'ssh' | 'cli'; command: string } {
  const name = executable.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (name === 'ssh') return { tool: 'ssh', command: 'ssh' };
  if (name !== 'gh') return { tool: 'cli', command: 'cli' };
  const [group, action] = args;
  if (group === 'api') return { tool: 'gh', command: action === 'graphql' ? 'api graphql' : 'api' };
  if (group && GH_GROUPS.has(group) && action && /^[a-z-]+$/.test(action)) return { tool: 'gh', command: `${group} ${action}` };
  return { tool: 'gh', command: group && /^[a-z-]+$/.test(group) ? group : 'gh' };
}
