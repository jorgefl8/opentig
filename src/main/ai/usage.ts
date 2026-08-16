import { EMPTY_AI_USAGE, type AiUsage } from '../../shared/ai-log';

/**
 * Token accounting reported by each harness. The three shapes are unrelated, so
 * each is read where it actually lives and normalized into one record. A missing
 * field stays null rather than becoming zero: "not reported" and "none used" are
 * different facts and only one of them is worth showing.
 */

/**
 * Claude Code answers with a single JSON envelope whose `usage` sits beside the
 * structured output the caller wants, plus a real dollar cost.
 */
export function claudeUsage(envelope: unknown): AiUsage {
  if (!envelope || typeof envelope !== 'object') return { ...EMPTY_AI_USAGE };
  const record = envelope as { usage?: unknown; total_cost_usd?: unknown };
  const usage = (record.usage ?? {}) as Record<string, unknown>;
  const details = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    reasoningTokens: count(details.thinking_tokens),
    cacheReadTokens: count(usage.cache_read_input_tokens),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
    costUsd: count(record.total_cost_usd, true),
  };
}

/**
 * Codex streams JSONL events on stdout and reports usage once, in the final
 * `turn.completed`. It reports no cost, so that stays null instead of being
 * guessed from a price table that would drift.
 */
export function codexUsage(stdout: string): AiUsage {
  let usage: Record<string, unknown> | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{') || !line.includes('turn.completed')) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; usage?: unknown };
      if (event.type === 'turn.completed' && event.usage && typeof event.usage === 'object') {
        usage = event.usage as Record<string, unknown>;
      }
    } catch { continue; }
  }
  if (!usage) return { ...EMPTY_AI_USAGE };
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    reasoningTokens: count(usage.reasoning_output_tokens),
    cacheReadTokens: count(usage.cached_input_tokens),
    cacheWriteTokens: count(usage.cache_write_input_tokens),
    costUsd: null,
  };
}

/**
 * OpenCode is driven through its local server, so usage arrives already typed on
 * the assistant message rather than as text to parse.
 */
export function openCodeUsage(info: unknown): AiUsage {
  if (!info || typeof info !== 'object') return { ...EMPTY_AI_USAGE };
  const record = info as { tokens?: unknown; cost?: unknown };
  const tokens = (record.tokens ?? {}) as Record<string, unknown>;
  const cache = (tokens.cache ?? {}) as Record<string, unknown>;
  return {
    inputTokens: count(tokens.input),
    outputTokens: count(tokens.output),
    reasoningTokens: count(tokens.reasoning),
    cacheReadTokens: count(cache.read),
    cacheWriteTokens: count(cache.write),
    costUsd: count(record.cost, true),
  };
}

function count(value: unknown, fractional = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return fractional ? value : Math.round(value);
}
