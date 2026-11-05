import { parse } from 'yaml';
import type { WorkflowInput, WorkflowTriggers } from '../../shared/contracts';

const INPUT_TYPES = new Set<WorkflowInput['type']>(['string', 'boolean', 'choice', 'number', 'environment']);

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * The events that start a workflow, and the inputs of its manual run when it
 * has one, as its file declares them. Null when the text isn't a workflow.
 */
export function parseWorkflowTriggers(text: string): WorkflowTriggers | null {
  let document: unknown;
  try { document = parse(text, { maxAliasCount: 100 }); } catch { return null; }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const on = (document as Record<string, unknown>).on;
  const events = typeof on === 'string' ? [on]
    : Array.isArray(on) ? on.filter((event): event is string => typeof event === 'string')
      : on && typeof on === 'object' ? Object.keys(on) : null;
  if (!events) return null;
  if (!events.includes('workflow_dispatch')) return { events, inputs: null };
  const dispatch = on && typeof on === 'object' && !Array.isArray(on) ? (on as Record<string, unknown>).workflow_dispatch : null;
  const rawInputs = dispatch && typeof dispatch === 'object' ? (dispatch as { inputs?: unknown }).inputs : null;
  const inputs: WorkflowInput[] = rawInputs && typeof rawInputs === 'object' && !Array.isArray(rawInputs)
    ? Object.entries(rawInputs as Record<string, unknown>).map(([name, value]) => {
      const spec = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const declared = typeof spec.type === 'string' ? spec.type as WorkflowInput['type'] : 'string';
      const options = Array.isArray(spec.options) ? spec.options.map(scalar).filter((option): option is string => option !== null) : [];
      return {
        name,
        description: typeof spec.description === 'string' && spec.description.trim() ? spec.description.trim() : null,
        required: spec.required === true,
        default: scalar(spec.default),
        // An unknown type is entered as text; GitHub says if it isn't valid.
        type: INPUT_TYPES.has(declared) && (declared !== 'choice' || options.length > 0) ? declared : 'string',
        options,
      };
    })
    : [];
  return { events, inputs };
}
