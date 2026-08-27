import type { AiHarnessId, AiHarnessStatus } from '../../../shared/contracts';

export function harnessLabel(harness: AiHarnessId): string {
  return harness === 'codex' ? 'Codex' : harness === 'claude' ? 'Claude Code' : 'OpenCode';
}

export function aiModelLabel(providers: AiHarnessStatus[] | undefined, harness: AiHarnessId, model: string): string {
  return providers?.find((provider) => provider.id === harness)?.models.find((option) => option.id === model)?.label
    ?? (model === 'default' ? 'Default (CLI)' : model);
}
