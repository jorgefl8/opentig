import { EMPTY_AI_USAGE } from '../../../shared/ai-log';
import { AI_PROVIDER_TIMEOUT_MS } from '../../../shared/ai-timeouts';
import type { AiHarnessStatus } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { parseJsonPayload } from '../CommitMessagePrompt';
import { isOpenCodeV2Version, openCodeCliName, openCodeLoginCommand, parseOpenCodeAuthList, parseOpenCodeModels } from '../open-code-cli';
import { generateOpenCodeV2Text, startOpenCodeV2Server } from '../open-code-server';
import { DEFAULT_MODEL, type AiProvider, type ProviderGenerateInput } from '../types';
import { requireSuccess } from './provider-utils';

const UNSUPPORTED_MESSAGE = 'OpenCode 2.x is required. Upgrade the installed CLI; OpenCode 1 and legacy beta builds are not supported.';

export class OpenCodeProvider implements AiProvider {
  readonly id = 'opencode' as const;
  private readonly servers = new Set<{ close(): void }>();
  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner) {}

  async status(forceRefresh = false): Promise<AiHarnessStatus> {
    const checkedAt = new Date().toISOString();
    const detected = await this.detect(forceRefresh);
    if (!detected) return { id: this.id, label: 'OpenCode', availability: 'error', installed: false, authStatus: 'unknown', message: 'Install OpenCode 2 to use this harness.', models: [DEFAULT_MODEL], checkedAt };
    const { executable, version, compatible } = detected;
    const cliName = openCodeCliName(executable);
    if (!compatible) return { id: this.id, label: 'OpenCode', availability: 'error', installed: true, authStatus: 'unknown', message: UNSUPPORTED_MESSAGE, cliName, version, models: [DEFAULT_MODEL], checkedAt };
    const [auth, catalog] = await Promise.all([
      this.runner.run(executable, ['auth', 'list', '--format', 'json', '--standalone']),
      this.runner.run(executable, ['models', '--standalone'], { timeoutMs: 30_000 }),
    ]);
    const models = catalog.exitCode === 0 ? parseOpenCodeModels(catalog.stdout) : [DEFAULT_MODEL];
    let authStatus = parseOpenCodeAuthList(auth.stdout, auth.exitCode);
    // Free catalog models can work without a stored credential; do not block generation.
    if (authStatus === 'unauthenticated' && models.length > 1) authStatus = 'unknown';
    const confirmed = authStatus === 'authenticated';
    return {
      id: this.id, label: 'OpenCode', availability: models.length > 1 ? (confirmed ? 'ready' : 'warning') : (authStatus === 'unauthenticated' ? 'error' : 'warning'),
      installed: true, authStatus, cliName, version, models, checkedAt,
      ...(authStatus === 'unauthenticated' ? { message: `Run ${openCodeLoginCommand(cliName)}.` } : !confirmed ? { message: 'Could not confirm authentication for the selected provider.' } : {}),
    };
  }

  async generate(input: ProviderGenerateInput) {
    const detected = await this.detect(false, input.signal);
    if (!detected) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'opencode-generate', harness: this.id, message: 'OpenCode is not installed.' });
    if (!detected.compatible) throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'opencode-generate', harness: this.id, message: UNSUPPORTED_MESSAGE });
    const executable = detected.executable;
    const timeoutSignal = AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS);
    const boundedInput = { ...input, signal: AbortSignal.any([input.signal, timeoutSignal]) };
    try {
      return await this.generateV2(executable, boundedInput);
    } catch (error) {
      if (timeoutSignal.aborted && !input.signal.aborted) {
        throw new AiOperationError({ code: 'AI_TIMEOUT', operation: 'opencode-generate', harness: this.id, message: 'Generation took too long.', retryable: true });
      }
      throw error;
    }
  }

  private async generateV2(executable: string, input: ProviderGenerateInput) {
    const server = await startOpenCodeV2Server({ executable, cwd: input.repositoryPath, timeoutMs: 15_000, signal: input.signal }).catch((error) => {
      if (error instanceof AiOperationError) throw error;
      throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'opencode-server', harness: this.id, message: 'Could not start the local OpenCode server.', retryable: true });
    });
    this.servers.add(server);
    try {
      const text = await generateOpenCodeV2Text(server, { prompt: `Reply with a single JSON object satisfying this JSON Schema:\n${JSON.stringify(input.schema)}\n\n${input.prompt}`, model: input.model, cwd: input.repositoryPath, signal: input.signal });
      return { output: parseJsonPayload(text), usage: { ...EMPTY_AI_USAGE } };
    } catch (error) {
      if (input.signal.aborted) throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'opencode-generate', harness: this.id, message: 'Generation canceled.' });
      if (error instanceof AiOperationError) throw error;
      const synthetic = { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : '' };
      requireSuccess(synthetic, this.id, 'opencode-generate');
      throw error;
    } finally {
      server.close();
      this.servers.delete(server);
    }
  }

  private async detect(forceRefresh = false, signal?: AbortSignal) {
    const candidates = await this.resolver.resolveAll('opencode', forceRefresh);
    let first: { executable: string; version: string; compatible: boolean } | null = null;
    for (const executable of candidates) {
      try {
        const result = await this.runner.run(executable, ['--version'], signal ? { signal } : {});
        const version = result.stdout.trim() || result.stderr.trim();
        const detected = { executable, version, compatible: result.exitCode === 0 && isOpenCodeV2Version(version) };
        if (detected.compatible) return detected;
        first ??= detected;
      } catch (error) {
        if (signal?.aborted) throw error;
        first ??= { executable, version: '', compatible: false };
      }
    }
    return first;
  }

  close(): void {
    for (const server of this.servers) server.close();
    this.servers.clear();
  }
}
