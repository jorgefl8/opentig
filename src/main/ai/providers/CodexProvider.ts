import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AiHarnessStatus, AiModelOption } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { parseJsonPayload } from '../CommitMessagePrompt';
import { DEFAULT_MODEL, type AiProvider, type ProviderGenerateInput } from '../types';
import { codexUsage } from '../usage';
import { requireSuccess } from './provider-utils';

export class CodexProvider implements AiProvider {
  readonly id = 'codex' as const;
  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner) {}

  async status(forceRefresh = false): Promise<AiHarnessStatus> {
    const checkedAt = new Date().toISOString();
    const executable = await this.resolver.resolve('codex', forceRefresh);
    if (!executable) return { id: this.id, label: 'Codex', availability: 'error', installed: false, authStatus: 'unknown', message: 'Install Codex CLI to use this harness.', models: [DEFAULT_MODEL], checkedAt };
    const version = await this.runner.run(executable, ['--version']);
    const login = await this.runner.run(executable, ['login', 'status']);
    if (login.exitCode !== 0 || !/logged in/i.test(`${login.stdout}\n${login.stderr}`)) {
      return { id: this.id, label: 'Codex', availability: 'error', installed: true, authStatus: 'unauthenticated', version: version.stdout.trim() || version.stderr.trim(), message: 'Run codex login.', models: [DEFAULT_MODEL], checkedAt };
    }
    const catalog = await this.runner.run(executable, ['debug', 'models', '--bundled']);
    const models = catalog.exitCode === 0 ? parseCodexModels(catalog.stdout) : [DEFAULT_MODEL];
    return {
      id: this.id, label: 'Codex', availability: models.length > 1 ? 'ready' : 'warning', installed: true, authStatus: 'authenticated',
      version: version.stdout.trim() || version.stderr.trim(), ...(models.length > 1 ? {} : { message: 'Available; the model catalog could not be verified.' }), models, checkedAt,
    };
  }

  async generate(input: ProviderGenerateInput) {
    const executable = await this.resolver.resolve('codex');
    if (!executable) throw new AiOperationError({ code: 'AI_CLI_NOT_FOUND', operation: 'codex-generate', harness: this.id, message: 'Codex is not installed.' });
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'opentig-codex-'));
    const schemaPath = path.join(temporary, 'schema.json');
    const outputPath = path.join(temporary, 'output.json');
    try {
      await writeFile(schemaPath, JSON.stringify(input.schema), { encoding: 'utf8', mode: 0o600 });
      // `--json` turns stdout into a JSONL event stream carrying the token
      // usage. The answer itself still comes from --output-last-message, so this
      // only adds information that was previously discarded.
      const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only'];
      if (input.model !== 'default') args.push('--model', input.model);
      args.push('--config', 'model_reasoning_effort="low"', '--output-schema', schemaPath, '--output-last-message', outputPath, '-');
      const result = await this.runner.run(executable, args, { cwd: input.repositoryPath, stdin: input.prompt, timeoutMs: 180_000, signal: input.signal, removeEnv: ['OPENAI_API_KEY'] });
      requireSuccess(result, this.id, 'codex-generate');
      return { output: parseJsonPayload(await readFile(outputPath, 'utf8')), usage: codexUsage(result.stdout) };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

function parseCodexModels(raw: string): AiModelOption[] {
  try {
    const parsed = JSON.parse(raw) as { models?: Array<{ slug?: unknown; display_name?: unknown; visibility?: unknown }> };
    const options = (parsed.models ?? []).filter((item) => typeof item.slug === 'string' && item.visibility !== 'hidden').map((item) => ({ id: item.slug as string, label: typeof item.display_name === 'string' ? item.display_name : item.slug as string }));
    return [DEFAULT_MODEL, ...options];
  } catch { return [DEFAULT_MODEL]; }
}
