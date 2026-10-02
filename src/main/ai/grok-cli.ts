import type { AiAuthStatus, AiModelOption } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import { parseJsonPayload } from './CommitMessagePrompt';
import { stripAnsi } from './providers/provider-utils';

export function isSupportedGrokVersion(raw: string): boolean {
  const match = /^grok (\d+)\.(\d+)\.(\d+)\b/i.exec(stripAnsi(raw).trim());
  return !!match && Number(match[1]) === 1 && (Number(match[2]) > 0 || Number(match[3]) >= 46);
}

export function parseGrokModels(raw: string): { authStatus: AiAuthStatus; models: AiModelOption[] } {
  const text = stripAnsi(raw);
  const authStatus = /You are not authenticated\./.test(text) ? 'unauthenticated'
    : /You are logged in with |You are using XAI_API_KEY\.|is using its own API key\.|authenticated via deployment key/.test(text) ? 'authenticated' : 'unknown';
  const models: AiModelOption[] = [{ id: 'default', label: 'Default (Grok)' }];
  const seen = new Set(['default']);
  const catalog = text.split('Available models:')[1] ?? '';
  for (const line of catalog.split(/\r?\n/)) {
    const match = /^\s+[*-]\s+([^\s]+?)(?:\s+\(default\))?\s*$/.exec(line);
    const id = match?.[1];
    if (id && id.length <= 200 && /^[\w.:/#-]+$/.test(id) && !seen.has(id)) {
      seen.add(id);
      models.push({ id, label: id });
    }
  }
  return { authStatus, models };
}

export function parseGrokOutput(raw: string): { envelope: Record<string, unknown>; output: Record<string, unknown> } {
  let envelope: Record<string, unknown>;
  try { envelope = parseJsonPayload(stripAnsi(raw)); } catch { throw invalidOutput(); }
  if (envelope.type === 'error' || envelope.structuredOutputError || envelope.stopReason !== 'end_turn') throw invalidOutput();
  const structured = envelope.structuredOutput;
  if (structured !== undefined) {
    if (!structured || typeof structured !== 'object' || Array.isArray(structured)) throw invalidOutput();
    return { envelope, output: structured as Record<string, unknown> };
  }
  if (typeof envelope.text !== 'string') throw invalidOutput();
  try { return { envelope, output: parseJsonPayload(envelope.text) }; } catch { throw invalidOutput(); }
}

function invalidOutput(): AiOperationError {
  return new AiOperationError({ code: 'AI_INVALID_OUTPUT', operation: 'grok-generate', harness: 'grok', message: 'Grok returned an incomplete or invalid structured response.', retryable: true });
}
