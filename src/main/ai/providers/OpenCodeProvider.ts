import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';
import type { AiHarnessStatus, AiModelOption } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { parseJsonPayload } from '../CommitMessagePrompt';
import { DEFAULT_MODEL, type AiProvider, type ProviderGenerateInput } from '../types';
import { requireSuccess, stripAnsi } from './provider-utils';

const DISABLED_TOOLS = { bash: false, edit: false, write: false, read: false, glob: false, grep: false, webfetch: false, websearch: false, task: false };

export class OpenCodeProvider implements AiProvider {
  readonly id = 'opencode' as const;
  private readonly servers = new Set<{ close(): void }>();
  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner) {}

  async status(forceRefresh = false): Promise<AiHarnessStatus> {
    const checkedAt = new Date().toISOString();
    const executable = await this.resolver.resolve('opencode', forceRefresh);
    if (!executable) return { id: this.id, label: 'OpenCode', availability: 'error', installed: false, authStatus: 'unknown', message: 'Install OpenCode to use this harness.', models: [DEFAULT_MODEL], checkedAt };
    const [version, auth, catalog] = await Promise.all([
      this.runner.run(executable, ['--version']), this.runner.run(executable, ['auth', 'list']), this.runner.run(executable, ['models']),
    ]);
    const models = catalog.exitCode === 0 ? parseOpenCodeModels(catalog.stdout) : [DEFAULT_MODEL];
    const hasCredentials = auth.exitCode === 0 && /credential/i.test(stripAnsi(auth.stdout));
    return {
      id: this.id, label: 'OpenCode', availability: models.length > 1 ? (hasCredentials ? 'ready' : 'warning') : 'warning', installed: true,
      authStatus: hasCredentials ? 'authenticated' : 'unknown', version: version.stdout.trim() || version.stderr.trim(),
      ...(!hasCredentials ? { message: 'Could not confirm authentication for the selected provider.' } : {}), models, checkedAt,
    };
  }

  async generate(input: ProviderGenerateInput) {
    const executable = await this.resolver.resolve('opencode');
    if (!executable) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'opencode-generate', harness: this.id, message: 'OpenCode is not installed.' });
    const server = await createOpencodeServer({
      hostname: '127.0.0.1', port: 0, timeout: 15_000, signal: input.signal,
      config: { share: 'disabled', autoupdate: false, plugin: [], instructions: [], tools: DISABLED_TOOLS, permission: { edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' } },
    }).catch(() => { throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'opencode-server', harness: this.id, message: 'No se pudo iniciar el servidor local de OpenCode.', retryable: true }); });
    this.servers.add(server);
    const client = createOpencodeClient({ baseUrl: server.url, directory: input.repositoryPath });
    let sessionId: string | null = null;
    try {
      const created = await client.session.create({ body: { title: 'JustGit commit message' }, query: { directory: input.repositoryPath } });
      if (!created.data?.id) throw new Error('missing session');
      sessionId = created.data.id;
      const model = input.model === 'default' ? undefined : parseModel(input.model);
      const response = await client.session.prompt({
        path: { id: sessionId }, query: { directory: input.repositoryPath },
        body: { parts: [{ type: 'text', text: input.prompt }], tools: DISABLED_TOOLS, ...(model ? { model } : {}) },
      });
      const infoError = response.data?.info && 'error' in response.data.info ? response.data.info.error : undefined;
      if (infoError) throw new Error('provider rejected request');
      const text = (response.data?.parts ?? []).filter((part): part is typeof part & { type: 'text'; text: string } => part.type === 'text' && 'text' in part && typeof part.text === 'string').map((part) => part.text).join('').trim();
      return parseJsonPayload(text);
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

function parseOpenCodeModels(raw: string): AiModelOption[] {
  const seen = new Set<string>();
  const models = stripAnsi(raw).split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+$/.test(line) && !seen.has(line) && seen.add(line)).map((id) => ({ id, label: id }));
  return [DEFAULT_MODEL, ...models];
}

function parseModel(value: string): { providerID: string; modelID: string } {
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) throw new AiOperationError({ code: 'AI_MODEL_UNAVAILABLE', operation: 'opencode-generate', harness: 'opencode', message: 'The OpenCode model must use provider/model.' });
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}
