import path from 'node:path';
import type { AiAuthStatus, AiModelOption } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import { DEFAULT_MODEL } from './types';
import { stripAnsi } from './providers/provider-utils';

export type OpenCodeCliName = 'opencode' | 'opencode2';

export function openCodeCliName(executable: string): OpenCodeCliName {
  return path.parse(executable).name.toLowerCase() === 'opencode2' ? 'opencode2' : 'opencode';
}

export function isOpenCodeV2(executable: string): boolean {
  return openCodeCliName(executable) === 'opencode2';
}

export function openCodeLoginCommand(cliName: OpenCodeCliName): string {
  return cliName === 'opencode2' ? 'opencode2 auth login' : 'opencode auth login';
}

export function parseOpenCodeAuthList(raw: string, exitCode: number): AiAuthStatus {
  if (exitCode !== 0) return 'unknown';
  const text = stripAnsi(raw);
  if (/no authenticated/i.test(text)) return 'unauthenticated';
  if (/credential/i.test(text)) return 'authenticated';
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => /^[A-Za-z0-9._-]+$/.test(line) && !/^(providers?|credentials?|integrations?)$/i.test(line))) {
    return 'authenticated';
  }
  return 'unknown';
}

export function parseOpenCodeModels(raw: string): AiModelOption[] {
  const seen = new Set<string>();
  const models = stripAnsi(raw).split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+$/.test(line) && !seen.has(line) && seen.add(line)).map((id) => ({ id, label: id }));
  return [DEFAULT_MODEL, ...models];
}

export function parseOpenCodeV1Model(value: string): { providerID: string; modelID: string } {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) throw invalidModel();
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

export function parseOpenCodeV2ModelRef(value: string): { id: string; providerID: string; variant?: string } {
  const parsed = parseOpenCodeV1Model(value);
  const hash = parsed.modelID.lastIndexOf('#');
  if (hash > 0 && hash < parsed.modelID.length - 1) {
    return { providerID: parsed.providerID, id: parsed.modelID.slice(0, hash), variant: parsed.modelID.slice(hash + 1) };
  }
  return { providerID: parsed.providerID, id: parsed.modelID };
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
