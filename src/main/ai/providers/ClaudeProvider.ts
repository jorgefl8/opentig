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
    const executable = await this.resolver.resolve('claude', forceRefresh);
    if (!executable) return { id: this.id, label: 'Claude Code', availability: 'error', installed: false, authStatus: 'unknown', message: 'Install Claude Code to use this harness.', models: MODELS, checkedAt };
    const version = await this.runner.run(executable, ['--version']);
    const auth = await this.runner.run(executable, ['auth', 'status', '--json']);
    let loggedIn: boolean;
    try { loggedIn = auth.exitCode === 0 && (JSON.parse(auth.stdout) as { loggedIn?: unknown }).loggedIn === true; } catch { loggedIn = false; }
    return {
      id: this.id, label: 'Claude Code', availability: loggedIn ? 'ready' : 'error', installed: true,
      authStatus: loggedIn ? 'authenticated' : 'unauthenticated', version: version.stdout.trim() || version.stderr.trim(),
      ...(!loggedIn ? { message: 'Run claude auth login.' } : {}), models: MODELS, checkedAt,
    };
  }

  async generate(input: ProviderGenerateInput) {
    const executable = await this.resolver.resolve('claude');
    if (!executable) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'claude-generate', harness: this.id, message: 'Claude Code is not installed.' });
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(input.schema), '--tools', '', '--no-session-persistence', '--safe-mode'];
    if (input.model !== 'default') args.push('--model', input.model);
    const result = await this.runner.run(executable, args, { cwd: input.repositoryPath, stdin: input.prompt, timeoutMs: AI_PROVIDER_TIMEOUT_MS, signal: input.signal, removeEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] });
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
  }
}
