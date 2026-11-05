import { parse } from 'yaml';
import type { ActionRunGraphNode } from '../../shared/contracts';

export interface WorkflowJobDefinition {
  id: string;
  /** The job's `name:`, when it has one. */
  name: string | null;
  needs: string[];
}

/** The jobs of a workflow file and what each one needs, or null when the file can't be read as a workflow. */
export function parseWorkflowJobs(text: string): WorkflowJobDefinition[] | null {
  let document: unknown;
  try { document = parse(text, { maxAliasCount: 100 }); } catch { return null; }
  if (!document || typeof document !== 'object') return null;
  const jobs = (document as { jobs?: unknown }).jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) return null;
  return Object.entries(jobs as Record<string, unknown>).map(([id, value]) => {
    const job = value && typeof value === 'object' ? value as { name?: unknown; needs?: unknown } : {};
    const needs = typeof job.needs === 'string' ? [job.needs] : Array.isArray(job.needs) ? job.needs.filter((item): item is string => typeof item === 'string') : [];
    return { id, name: typeof job.name === 'string' ? job.name : null, needs };
  });
}

/**
 * The name GitHub shows for a workflow job and a prefix for its run jobs. A
 * matrix adds " (values)", a reusable workflow " / inner job", and a name with
 * an expression is only known up to the expression.
 */
function displayName(job: WorkflowJobDefinition): { label: string; exact: boolean } {
  if (job.name === null) return { label: job.id, exact: true };
  const expression = job.name.indexOf('${{');
  if (expression === -1) return { label: job.name, exact: true };
  const prefix = job.name.slice(0, expression).trim();
  return { label: prefix || job.id, exact: false };
}

function belongsTo(jobName: string, label: string, exact: boolean): boolean {
  if (jobName === label || jobName.startsWith(`${label} (`) || jobName.startsWith(`${label} / `)) return true;
  return !exact && label.length > 0 && jobName.startsWith(label);
}

/** The base name of a run job without its matrix values, to group jobs when the workflow file is unknown. */
function baseName(jobName: string): string {
  return jobName.replace(/ \([^()]*\)$/, '');
}

/**
 * Places each run job under the workflow job that produced it. Run jobs no
 * workflow job claims (a renamed job, or no workflow file) get a node of
 * their own, grouped by name without matrix values.
 */
export function buildRunGraph(definition: WorkflowJobDefinition[] | null, jobs: { id: number; name: string }[]): { graph: ActionRunGraphNode[]; source: 'workflow' | 'jobs' } {
  const nodes: ActionRunGraphNode[] = [];
  const claimed = new Set<number>();
  if (definition) {
    const ids = new Set(definition.map((job) => job.id));
    const labels = definition.map((job) => ({ job, ...displayName(job) }));
    // Longer names first, so "build" doesn't take "build docs (linux)".
    const byLength = [...labels].sort((left, right) => right.label.length - left.label.length);
    const owned = new Map<string, number[]>(definition.map((job) => [job.id, []]));
    for (const job of jobs) {
      const owner = byLength.find((candidate) => candidate.exact && belongsTo(job.name, candidate.label, true))
        ?? byLength.find((candidate) => !candidate.exact && belongsTo(job.name, candidate.label, false));
      if (!owner) continue;
      owned.get(owner.job.id)!.push(job.id);
      claimed.add(job.id);
    }
    for (const { job, label } of labels) {
      nodes.push({ id: job.id, name: label, needs: [...new Set(job.needs.filter((need) => ids.has(need) && need !== job.id))], jobIds: owned.get(job.id)! });
    }
  }
  const extra = new Map<string, ActionRunGraphNode>();
  for (const job of jobs) {
    if (claimed.has(job.id)) continue;
    const name = baseName(job.name);
    const id = `job:${name}`;
    const node = extra.get(id) ?? { id, name, needs: [], jobIds: [] };
    node.jobIds.push(job.id);
    extra.set(id, node);
  }
  nodes.push(...extra.values());
  return { graph: nodes, source: definition ? 'workflow' : 'jobs' };
}
