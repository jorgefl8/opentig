import path from 'node:path';
import type { AiAuthStatus, AiModelOption } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import { DEFAULT_MODEL } from './types';
import { stripAnsi } from './providers/provider-utils';

export type OpenCodeCliName = 'opencode' | 'opencode2';

export function openCodeCliName(executable: string): OpenCodeCliName {
  return path.parse(executable).name.toLowerCase() === 'opencode2' ? 'opencode2' : 'opencode';
}

export function isOpenCodeV2Version(raw: string): boolean {
  return /^(?:opencode2?\s+)?v?2\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(stripAnsi(raw).trim());
}

export function openCodeLoginCommand(cliName: OpenCodeCliName): string {
  return cliName === 'opencode2' ? 'opencode2 auth login' : 'opencode auth login';
}

export function parseOpenCodeAuthList(raw: string, exitCode: number): AiAuthStatus {
  if (exitCode !== 0) return 'unknown';
  try {
    const integrations: unknown = JSON.parse(stripAnsi(raw).trim());
    if (!Array.isArray(integrations) || integrations.some((item) => !item || typeof item !== 'object' || !Array.isArray(item.connections))) return 'unknown';
    return integrations.some((item) => item.connections.length > 0) ? 'authenticated' : 'unauthenticated';
  } catch {
    // Unrecognized output never proves authentication.
  }
  return 'unknown';
}

export function parseOpenCodeModels(raw: string): AiModelOption[] {
  const seen = new Set<string>();
  const models = stripAnsi(raw).split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+(?:#[A-Za-z0-9._-]+)?$/.test(line) && !seen.has(line) && seen.add(line)).map((id) => ({ id, label: id }));
  return [DEFAULT_MODEL, ...models];
}

export function parseOpenCodeV2ModelRef(value: string): { id: string; providerID: string; variant?: string } {
  const match = /^([^/#\s]+)\/([^#\s]+)(?:#([^#\s]+))?$/.exec(value);
  if (!match?.[1] || !match[2]) throw invalidModel();
  return { providerID: match[1], id: match[2], ...(match[3] ? { variant: match[3] } : {}) };
}

export function parseOpenCodeV2GenerateText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw invalidOutput();
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw invalidOutput();
  const text = (data as { text?: unknown }).text;
  if (typeof text !== 'string' || !text.trim()) throw invalidOutput();
  return text;
}

export function parseOpenCodeV2SessionId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw invalidOutput();
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw invalidOutput();
  const id = (data as { id?: unknown }).id;
  if (typeof id !== 'string' || !id.startsWith('ses')) throw invalidOutput();
  return id;
}

function invalidModel(): AiOperationError {
  return new AiOperationError({ code: 'AI_MODEL_UNAVAILABLE', operation: 'opencode-generate', harness: 'opencode', message: 'The OpenCode model must use provider/model.' });
}

function invalidOutput(): AiOperationError {
  return new AiOperationError({ code: 'AI_INVALID_OUTPUT', operation: 'opencode-generate', harness: 'opencode', message: 'OpenCode returned an invalid response.', retryable: true });
}
