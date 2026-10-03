import type { AiHarnessStatus } from '../../shared/contracts';
import { AiOperationError } from '../../shared/errors';
import type { CliProcessRunner, CliRunOptions } from './CliProcessRunner';
import type { CliCandidate, CliName, CliResolver } from './CliResolver';

export interface CliDetection {
  candidate?: CliCandidate;
  version?: string;
  state: 'available' | 'not-found' | 'not-executable' | 'incompatible' | 'inspection-failed';
  warning?: string | undefined;
}

export function runCandidate(runner: CliProcessRunner, candidate: CliCandidate, args: string[], options: CliRunOptions = {}) {
  return runner.run(candidate.executable, args, { ...options, env: { ...candidate.env, ...options.env } });
}

export async function selectCli(resolver: CliResolver, runner: CliProcessRunner, name: CliName, options: {
  forceRefresh?: boolean;
  compatible?: (version: string) => boolean;
  runOptions?: CliRunOptions;
} = {}): Promise<CliDetection> {
  let first: CliDetection | undefined;
  const candidates = await resolver.discover(name, options.forceRefresh);
  for (const candidate of candidates) {
    if (options.runOptions?.signal?.aborted) throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'cli-discovery', message: 'Generation canceled.' });
    if (candidate.problem) { first ??= { candidate, state: candidate.problem }; continue; }
    try {
      const result = await runCandidate(runner, candidate, ['--version'], options.runOptions);
      // Only the bounded first line is exposed; raw stderr is never a diagnostic.
      const raw = result.stdout.trim() || result.stderr.trim();
      const version = (raw.split(/\r?\n/)[0] ?? '').slice(0, 200);
      if (result.exitCode !== 0 || !version) { first ??= { candidate, state: 'not-executable' }; continue; }
      if (options.compatible && !options.compatible(raw)) { first ??= { candidate, version, state: 'incompatible' }; continue; }
      return { candidate, version, state: 'available', warning: candidate.warning };
    } catch (error) {
      if (options.runOptions?.signal?.aborted) throw error;
      first ??= { candidate, state: 'not-executable' };
    }
  }
  const warning = await resolver.warning();
  return first ? { ...first, warning } : { state: warning ? 'inspection-failed' : 'not-found', warning };
}

export function detectionFields(detected: CliDetection): Pick<AiHarnessStatus, 'installationStatus' | 'executablePath' | 'executableSource' | 'discoveryWarning'> {
  return { installationStatus: detected.state, ...(detected.candidate ? { executablePath: detected.candidate.executable, executableSource: detected.candidate.source } : {}), ...(detected.warning ? { discoveryWarning: detected.warning } : {}) };
}

export function detectionFailure(detected: CliDetection, base: Pick<AiHarnessStatus, 'id' | 'label' | 'models' | 'checkedAt'>, unsupported?: string): AiHarnessStatus | null {
  if (detected.state === 'available') return null;
  const message = detected.state === 'not-found' ? (detected.candidate?.source === 'configured' ? 'The configured executable was not found. Correct the path or reset it to Automatic.' : `Install ${base.label} and check again, or set its executable path.`)
    : detected.state === 'incompatible' ? unsupported ?? 'The installed CLI version is not supported.'
      : detected.state === 'inspection-failed' ? 'Could not inspect the CLI installation. Check again or set its executable path.'
        : 'The CLI was found but could not run. Check executable permissions, runtime dependencies, and system compatibility.';
  return { ...base, ...detectionFields(detected), installed: !!detected.candidate && detected.state !== 'not-found', availability: 'error', authStatus: 'unknown', ...(detected.version ? { version: detected.version } : {}), message };
}

export function requireCandidate(detected: CliDetection, name: CliName): CliCandidate {
  if (detected.state !== 'available' || !detected.candidate) throw new AiOperationError({ code: detected.state === 'not-found' ? 'AI_CLI_NOT_FOUND' : 'AI_PROCESS_FAILED', operation: 'cli-discovery', message: `${name} could not be started. Check its status in Settings → AI assistance.` });
  return detected.candidate;
}
