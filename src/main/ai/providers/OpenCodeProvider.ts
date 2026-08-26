import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';
import { EMPTY_AI_USAGE } from '../../../shared/ai-log';
import { AI_PROVIDER_TIMEOUT_MS } from '../../../shared/ai-timeouts';
import type { AiHarnessStatus } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { parseJsonPayload } from '../CommitMessagePrompt';
import { isOpenCodeV2, openCodeCliName, openCodeLoginCommand, parseOpenCodeAuthList, parseOpenCodeModels, parseOpenCodeV1Model } from '../open-code-cli';
import { generateOpenCodeV2Text, startOpenCodeV2Server } from '../open-code-server';
import { DEFAULT_MODEL, type AiProvider, type ProviderGenerateInput } from '../types';
import { openCodeUsage } from '../usage';
import { requireSuccess } from './provider-utils';

const DISABLED_TOOLS = { bash: false, edit: false, write: false, read: false, glob: false, grep: false, webfetch: false, websearch: false, task: false };

export class OpenCodeProvider implements AiProvider {
  readonly id = 'opencode' as const;
  private readonly servers = new Set<{ close(): void }>();
  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner) {}

  async status(forceRefresh = false): Promise<AiHarnessStatus> {
    const checkedAt = new Date().toISOString();
    const executable = await this.resolver.resolve('opencode', forceRefresh);
    if (!executable) return { id: this.id, label: 'OpenCode', availability: 'error', installed: false, authStatus: 'unknown', message: 'Install OpenCode to use this harness.', models: [DEFAULT_MODEL], checkedAt };
    const cliName = openCodeCliName(executable);
    const catalogArgs = cliName === 'opencode2' ? ['models', '--standalone'] : ['models'];
    const [version, auth, catalog] = await Promise.all([
      this.runner.run(executable, ['--version']),
      this.runner.run(executable, ['auth', 'list']),
      this.runner.run(executable, catalogArgs, cliName === 'opencode2' ? { timeoutMs: 30_000 } : {}),
    ]);
    const models = catalog.exitCode === 0 ? parseOpenCodeModels(catalog.stdout) : [DEFAULT_MODEL];
    let authStatus = parseOpenCodeAuthList(`${auth.stdout}\n${auth.stderr}`, auth.exitCode);
    // Free catalog models can work without a stored credential; do not block generation.
    if (authStatus === 'unauthenticated' && models.length > 1) authStatus = 'unknown';
    const confirmed = authStatus === 'authenticated';
    return {
      id: this.id, label: 'OpenCode', availability: models.length > 1 ? (confirmed ? 'ready' : 'warning') : (authStatus === 'unauthenticated' ? 'error' : 'warning'),
      installed: true, authStatus, cliName, version: version.stdout.trim() || version.stderr.trim(), models, checkedAt,
      ...(authStatus === 'unauthenticated' ? { message: `Run ${openCodeLoginCommand(cliName)}.` } : !confirmed ? { message: 'Could not confirm authentication for the selected provider.' } : {}),
    };
  }

  async generate(input: ProviderGenerateInput) {
    const executable = await this.resolver.resolve('opencode');
    if (!executable) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'opencode-generate', harness: this.id, message: 'OpenCode is not installed.' });
    const timeoutSignal = AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS);
    const boundedInput = { ...input, signal: AbortSignal.any([input.signal, timeoutSignal]) };
    try {
      return await (isOpenCodeV2(executable) ? this.generateV2(executable, boundedInput) : this.generateV1(boundedInput));
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
      const text = await generateOpenCodeV2Text(server, { prompt: input.prompt, model: input.model, cwd: input.repositoryPath, signal: input.signal });
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

  private async generateV1(input: ProviderGenerateInput) {
    const server = await createOpencodeServer({
      hostname: '127.0.0.1', port: 0, timeout: 15_000, signal: input.signal,
      config: { share: 'disabled', autoupdate: false, plugin: [], instructions: [], tools: DISABLED_TOOLS, permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' } },
    }).catch(() => { throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'opencode-server', harness: this.id, message: 'Could not start the local OpenCode server.', retryable: true }); });
    this.servers.add(server);
    const client = createOpencodeClient({ baseUrl: server.url, directory: input.repositoryPath });
    let sessionId: string | null = null;
    try {
      const created = await client.session.create({ body: { title: 'OpenTig commit message' }, query: { directory: input.repositoryPath } });
      if (!created.data?.id) throw new Error('missing session');
      sessionId = created.data.id;
      const model = input.model === 'default' ? undefined : parseOpenCodeV1Model(input.model);
      const response = await client.session.prompt({
        path: { id: sessionId }, query: { directory: input.repositoryPath },
        body: {
          parts: [{ type: 'text', text: input.prompt }],
          tools: DISABLED_TOOLS,
          // The server API takes no schema, unlike the Codex and Claude CLIs, so
          // the only way to hold this harness to the contract is the system
          // prompt. Without it the model answers in whatever shape it likes.
          system: `Reply with a single JSON object and nothing else. It must satisfy this JSON Schema:
${JSON.stringify(input.schema)}`,
          ...(model ? { model } : {}),
        },
      });
      const infoError = response.data?.info && 'error' in response.data.info ? response.data.info.error : undefined;
      if (infoError) throw new Error('provider rejected request');
      const text = (response.data?.parts ?? []).filter((part): part is typeof part & { type: 'text'; text: string } => part.type === 'text' && 'text' in part && typeof part.text === 'string').map((part) => part.text).join('').trim();
      // Driving the local server means the accounting arrives already typed on
      // the assistant message instead of as a stream to parse.
      return { output: parseJsonPayload(text), usage: openCodeUsage(response.data?.info) };
    } catch (error) {
      if (input.signal?.aborted) throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'opencode-generate', harness: this.id, message: 'Generation canceled.' });
      if (error instanceof AiOperationError) throw error;
      const synthetic = { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : '' };
      requireSuccess(synthetic, this.id, 'opencode-generate');
      throw error;
    } finally {
      if (sessionId) await client.session.delete({ path: { id: sessionId }, query: { directory: input.repositoryPath } }).catch(() => undefined);
      server.close();
      this.servers.delete(server);
    }
  }

  close(): void {
    for (const server of this.servers) server.close();
    this.servers.clear();
  }
}
