import type { AiHarnessId } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import { redactSensitiveText } from '../../../shared/redaction';
import type { CliRunResult } from '../CliProcessRunner';

const DIAGNOSTIC_LIMIT = 400;

export function requireSuccess(result: CliRunResult, harness: AiHarnessId, operation: string): void {
  if (result.exitCode === 0) return;
  const diagnostic = cliDiagnostic(result);
  const raw = `${result.stderr}\n${result.stdout}\n${diagnostic ?? ''}`.toLowerCase();
  if (/not logged|login required|unauth|authentication|sign in/.test(raw)) {
    throw new AiOperationError({
      code: 'AI_AUTH_REQUIRED', operation, harness,
      message: withDetail(`Sign in to ${label(harness)} to generate the message.`, diagnostic),
    });
  }
  if (/rate.?limit|quota|usage limit|too many requests|credit/.test(raw)) {
    throw new AiOperationError({
      code: 'AI_RATE_LIMITED', operation, harness, exitCode: result.exitCode, retryable: true,
      message: withDetail(`${label(harness)} rejected the request because of a usage limit.`, diagnostic),
    });
  }
  if (/model.*(not found|unavailable|invalid|access|not supported)|unknown model/.test(raw)) {
    throw new AiOperationError({
      code: 'AI_MODEL_UNAVAILABLE', operation, harness, exitCode: result.exitCode,
      message: withDetail('The selected model is unavailable.', diagnostic),
    });
  }
  throw new AiOperationError({
    code: 'AI_PROCESS_FAILED', operation, harness, exitCode: result.exitCode, retryable: true,
    message: withDetail(`${label(harness)} could not generate the message.`, diagnostic),
  });
}

export function label(harness: AiHarnessId): string {
  return harness === 'codex' ? 'Codex' : harness === 'claude' ? 'Claude Code' : 'OpenCode';
}

export function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

/**
 * Codex `--output-schema` is sent as OpenAI structured output, which rejects
 * optional properties. Claude and OpenCode keep the looser schema; only this
 * copy is rewritten, and empty strings / empty arrays stay valid answers.
 */
export function toCodexOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return strictify(structuredClone(schema)) as Record<string, unknown>;
}

function strictify(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(strictify);
  const record = { ...(value as Record<string, unknown>) };
  delete record.$schema;
  if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
    const properties = Object.fromEntries(
      Object.entries(record.properties as Record<string, unknown>).map(([key, item]) => [key, strictify(item)]),
    );
    record.properties = properties;
    record.required = Object.keys(properties);
    record.additionalProperties = false;
  }
  if ('items' in record) record.items = strictify(record.items);
  for (const key of ['$defs', 'definitions'] as const) {
    const defs = record[key];
    if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
      record[key] = Object.fromEntries(
        Object.entries(defs as Record<string, unknown>).map(([name, item]) => [name, strictify(item)]),
      );
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(record[key])) record[key] = (record[key] as unknown[]).map(strictify);
  }
  return record;
}

/** Prefers Codex JSONL error events over raw streams, which can echo the prompt. */
export function cliDiagnostic(result: CliRunResult): string | null {
  let fromTurn: string | null = null;
  let fromError: string | null = null;
  let fromItem: string | null = null;
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        message?: unknown;
        error?: { message?: unknown };
        item?: { type?: unknown; message?: unknown };
      };
      if (event.type === 'turn.failed') {
        const message = unwrapMessage(event.error?.message);
        if (message) fromTurn = message;
      } else if (event.type === 'error') {
        const message = unwrapMessage(event.message);
        if (message) fromError = message;
      } else if (event.item?.type === 'error') {
        const message = unwrapMessage(event.item.message);
        if (message) fromItem = message;
      }
    } catch {
      continue;
    }
  }
  return sanitizeDiagnostic(fromTurn ?? fromError ?? fromItem ?? result.stderr);
}

function unwrapMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let current = value.trim();
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const parsed = JSON.parse(current) as { message?: unknown; error?: { message?: unknown } };
      const inner = typeof parsed.error?.message === 'string' ? parsed.error.message
        : typeof parsed.message === 'string' ? parsed.message
          : null;
      if (!inner || inner === current) break;
      current = inner.trim();
    } catch {
      break;
    }
  }
  return current || null;
}

function sanitizeDiagnostic(value: string | null | undefined): string | null {
  if (!value) return null;
  const flattened = flattenWhitespace(redactSensitiveText(stripAnsi(value)));
  if (!flattened) return null;
  return flattened.length > DIAGNOSTIC_LIMIT ? flattened.slice(0, DIAGNOSTIC_LIMIT) : flattened;
}

function withDetail(base: string, detail: string | null): string {
  if (!detail) return base;
  if (base.toLowerCase().includes(detail.toLowerCase())) return base;
  return `${base} ${detail}`;
}

function flattenWhitespace(value: string): string {
  let flattened = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    flattened += code < 32 || code === 127 ? ' ' : character;
  }
  return flattened.replace(/ {2,}/g, ' ').trim();
}
