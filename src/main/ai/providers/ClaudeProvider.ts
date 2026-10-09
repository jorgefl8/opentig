import { withGenerationEnvironment } from '../GenerationEnvironment';
import { detectionFailure, detectionFields, requireCandidate, runCandidate, selectCli } from '../cli-selection';
import type { AiHarnessStatus } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import { AI_PROVIDER_TIMEOUT_MS } from '../../../shared/ai-timeouts';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { DEFAULT_MODEL, type AiProvider, type ProviderGenerateInput } from '../types';
import { claudeUsage } from '../usage';
import { requireSuccess } from './provider-utils';

const MODELS = [DEFAULT_MODEL, { id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus' }, { id: 'haiku', label: 'Haiku' }];

export class ClaudeProvider implements AiProvider {
  readonly id = 'claude' as const;
  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner) {}

  async status(forceRefresh = false): Promise<AiHarnessStatus> {
    const checkedAt = new Date().toISOString();
    const detected = await selectCli(this.resolver, this.runner, 'claude', { forceRefresh });
    const failure = detectionFailure(detected, { id: this.id, label: 'Claude Code', models: MODELS, checkedAt });
    if (failure) return failure;
    const executable = requireCandidate(detected, this.id);
    const auth = await runCandidate(this.runner, executable, ['auth', 'status', '--json']);
    let loggedIn: boolean;
    try { loggedIn = auth.exitCode === 0 && (JSON.parse(auth.stdout) as { loggedIn?: unknown }).loggedIn === true; } catch { loggedIn = false; }
    return {
      ...detectionFields(detected), id: this.id, label: 'Claude Code', availability: loggedIn ? 'ready' : 'error', installed: true,
      authStatus: loggedIn ? 'authenticated' : 'unauthenticated', version: detected.version ?? '',
      ...(!loggedIn ? { message: 'Run claude auth login.' } : {}), models: MODELS, checkedAt,
    };
  }

  async generate(input: ProviderGenerateInput) {
    const executable = requireCandidate(await selectCli(this.resolver, this.runner, 'claude', { runOptions: { signal: input.signal } }), this.id);
    return withGenerationEnvironment('claude', executable.env, async (options) => {
      const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(input.schema), '--tools', '', '--no-session-persistence', '--safe-mode', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowedTools', 'mcp__*'];
      if (input.model !== 'default') args.push('--model', input.model);
      const result = await runCandidate(this.runner, executable, args, { ...options, stdin: input.prompt, timeoutMs: AI_PROVIDER_TIMEOUT_MS, signal: input.signal, removeEnv: [...(options.removeEnv ?? []), 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] });
      requireSuccess(result, this.id, 'claude-generate');
      try {
        const envelope = JSON.parse(result.stdout) as { structured_output?: unknown };
        const output = envelope.structured_output;
        if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('missing structured output');
        // The same envelope carries the token accounting and the dollar cost.
        return { output: output as Record<string, unknown>, usage: claudeUsage(envelope) };
      } catch (error) {
        if (error instanceof AiOperationError) throw error;
        throw new AiOperationError({ code: 'AI_INVALID_OUTPUT', operation: 'claude-generate', harness: this.id, message: 'Claude Code returned an invalid response.', retryable: true });
      }
    });
  }
}
