import { detectionFailure, detectionFields, requireCandidate, runCandidate, selectCli } from '../cli-selection';
import type { CliCandidate } from '../CliResolver';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AI_PROVIDER_TIMEOUT_MS } from '../../../shared/ai-timeouts';
import type { AiHarnessStatus } from '../../../shared/contracts';
import { AiOperationError } from '../../../shared/errors';
import type { CliProcessRunner, CliRunOptions, CliRunResult } from '../CliProcessRunner';
import type { CliResolver } from '../CliResolver';
import { isSupportedGrokVersion, parseGrokModels, parseGrokOutput } from '../grok-cli';
import { grokUsage } from '../usage';
import type { AiProvider, ProviderGenerateInput } from '../types';

const DEFAULT_MODEL = { id: 'default', label: 'Default (Grok)' };
const UNSUPPORTED = 'Grok Build 1.0.46 or later in the 1.x series is required, with headless JSON and tool controls.';
const CONFIG = '[cli]\nauto_update = false\n[subagents]\nenabled = false\n[managed_mcps]\nenabled = false\ngateway_tools_enabled = false\n[memory]\nenabled = false\n[features]\nmanaged_config = false\ntitle_refresh = false\nturn_summary = false\n';
const REQUIRED_FLAGS = ['--prompt-file', '--json-schema', '--output-format', '--tools', '--disallowed-tools', '--deny', '--disable-web-search', '--max-turns', '--permission-mode', '--verbatim'];

export class GrokProvider implements AiProvider {
  readonly id = 'grok' as const;
  constructor(private readonly resolver: CliResolver, private readonly runner: CliProcessRunner) {}

  async status(forceRefresh = false): Promise<AiHarnessStatus> {
    const checkedAt = new Date().toISOString();
    const base = { id: this.id, label: 'Grok Build', checkedAt, models: [DEFAULT_MODEL] };
    return this.withEnvironment(async (options) => {
      const detected = await selectCli(this.resolver, this.runner, this.id, { forceRefresh, compatible: isSupportedGrokVersion, runOptions: options });
      const failure = detectionFailure(detected, base, UNSUPPORTED);
      if (failure) return failure;
      const executable = requireCandidate(detected, this.id);
      const installed = { ...base, ...detectionFields(detected), installed: true, version: detected.version ?? '' };
      try {
        await this.checkControls(executable, options);
        const result = await runCandidate(this.runner, executable, ['models'], options);
        if (result.exitCode !== 0) return { ...installed, availability: 'warning', authStatus: 'unknown', message: 'Could not check Grok authentication or models. Check again or run grok models in a terminal.' };
        const { authStatus, models } = parseGrokModels(result.stdout);
        return { ...installed, models, authStatus, availability: authStatus === 'unauthenticated' ? 'error' : authStatus === 'authenticated' && models.length > 1 ? 'ready' : 'warning',
          ...(authStatus === 'unauthenticated' ? { message: 'Run grok login, or provide XAI_API_KEY to the OpenTig process.' } : authStatus === 'unknown' ? { message: 'Could not confirm Grok authentication.' } : {}) };
      } catch (error) {
        return { ...installed, availability: 'error', authStatus: 'unknown', message: error instanceof AiOperationError ? error.message : 'Could not verify Grok execution controls.' };
      }
    });
  }

  async generate(input: ProviderGenerateInput) {
    const timeout = AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS);
    const signal = AbortSignal.any([input.signal, timeout]);
    try {
      return await this.withEnvironment(async (options) => {
        const controlled = { ...options, signal };
        const executable = requireCandidate(await selectCli(this.resolver, this.runner, this.id, { compatible: isSupportedGrokVersion, runOptions: controlled }), this.id);
        await this.checkControls(executable, controlled);
        const promptFile = path.join(options.cwd!, 'prompt.txt');
        await writeFile(promptFile, input.prompt, { encoding: 'utf8', mode: 0o600 });
        // A non-empty allowlist followed by removal is deliberate: an empty
        // --tools string means no restriction. Remove the always-on MCP helpers too.
        const args = ['--prompt-file', promptFile, '--output-format', 'json', '--json-schema', JSON.stringify(input.schema), '--verbatim',
          '--tools', 'read_file', '--disallowed-tools', 'read_file,search_tool,use_tool,Agent', '--deny', 'MCPTool',
          '--disable-web-search', '--max-turns', '1', '--permission-mode', 'dontAsk', '--no-memory'];
        if (input.model !== 'default') args.push('--model', input.model);
        const result = await runCandidate(this.runner, executable, args, { ...controlled, timeoutMs: AI_PROVIDER_TIMEOUT_MS });
        requireGrokSuccess(result);
        const parsed = parseGrokOutput(result.stdout);
        return { output: parsed.output, usage: grokUsage(parsed.envelope) };
      });
    } catch (error) {
      if (input.signal.aborted) throw failure('AI_CANCELLED', 'Generation canceled.');
      if (timeout.aborted) throw failure('AI_TIMEOUT', 'Generation took too long.');
      throw error;
    }
  }

  private async checkControls(executable: CliCandidate, options: CliRunOptions): Promise<void> {
    const help = await runCandidate(this.runner, executable, ['--help'], options);
    if (help.exitCode !== 0 || REQUIRED_FLAGS.some((flag) => !help.stdout.includes(flag))) throw failure('AI_PROCESS_FAILED', UNSUPPORTED);
    const result = await runCandidate(this.runner, executable, ['inspect', '--json'], options);
    let report: Record<string, unknown>;
    try { report = JSON.parse(result.stdout) as Record<string, unknown>; } catch { throw failure('AI_PROCESS_FAILED', 'Could not verify the isolated Grok configuration.'); }
    const surfaces = ['hooks', 'plugins', 'mcpServers', 'projectInstructions'];
    if (result.exitCode !== 0 || !report || surfaces.some((key) => !Array.isArray(report[key]) || report[key].length > 0)) {
      throw failure('AI_PROCESS_FAILED', 'Grok configuration includes hooks, plugins, MCP servers or instructions. OpenTig requires an isolated text-only configuration.');
    }
  }

  private async withEnvironment<T>(run: (options: CliRunOptions) => Promise<T>): Promise<T> {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'opentig-grok-'));
    const userGrokHome = process.env.GROK_HOME || path.join(os.homedir(), '.grok');
    const authPath = path.resolve(process.env.GROK_AUTH_PATH || path.join(userGrokHome, 'auth.json'));
    const privateGrokHome = path.join(temporary, '.grok');
    try {
      await mkdir(privateGrokHome, { mode: 0o700 });
      await writeFile(path.join(privateGrokHome, 'config.toml'), CONFIG, { encoding: 'utf8', mode: 0o600 });
      const env = { HOME: temporary, USERPROFILE: temporary, GROK_HOME: privateGrokHome, GROK_AUTH_PATH: authPath,
        XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_DATA_HOME: path.join(temporary, 'data'), XDG_CACHE_HOME: path.join(temporary, 'cache'),
        GROK_SUBAGENTS: '0', GROK_MANAGED_MCPS_ENABLED: '0', GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: '0', GROK_TITLE_REFRESH: '0' };
      const preserved = new Set([...Object.keys(env), 'GROK_AUTH', 'GROK_CODE_XAI_API_KEY']);
      const removeEnv = Object.keys(process.env).filter((key) => key.startsWith('GROK_') && !preserved.has(key));
      return await run({ cwd: temporary, env, removeEnv });
    } finally {
      await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

function requireGrokSuccess(result: CliRunResult): void {
  if (result.exitCode === 0) return;
  const diagnostic = `${result.stdout}\n${result.stderr}`.toLowerCase();
  // Classify without echoing CLI diagnostics, which can contain prompt text.
  if (/not authenticated|not logged|login required|unauth|authentication|sign in/.test(diagnostic)) throw failure('AI_AUTH_REQUIRED', 'Sign in with grok login to generate content.');
  if (/rate.?limit|quota|usage limit|too many requests|credit/.test(diagnostic)) throw failure('AI_RATE_LIMITED', 'Grok rejected the request because of a usage limit.');
  if (/model.*(not found|unavailable|invalid|access|not supported)|unknown model/.test(diagnostic)) throw failure('AI_MODEL_UNAVAILABLE', 'The selected Grok model is unavailable.');
  throw failure('AI_PROCESS_FAILED', 'Grok could not generate content.');
}

function failure(code: ConstructorParameters<typeof AiOperationError>[0]['code'], message: string): AiOperationError {
  return new AiOperationError({ code, operation: 'grok-generate', harness: 'grok', message });
}
