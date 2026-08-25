import { spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { execa } from 'execa';
import { AiOperationError } from '../../shared/errors';
import { resolveProcessCommand } from '../process/resolveProcessCommand';
import { parseOpenCodeV2GenerateText, parseOpenCodeV2ModelRef, parseOpenCodeV2SessionId } from './open-code-cli';

interface OpenCodeChild {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown; off(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown; off(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  nodeChildProcess: ChildProcess;
  kill(): unknown;
}

const SERVER_USERNAME = 'opencode';
const LISTEN_PATTERN = /server listening on\s+(https?:\/\/\S+)/i;

export interface OpenCodeV2Server {
  url: string;
  password: string;
  close(): void;
}

export async function startOpenCodeV2Server(options: {
  executable: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<OpenCodeV2Server> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const password = randomBytes(24).toString('base64url');
  const port = await freePort();
  const environment = Object.fromEntries(
    Object.entries({
      ...process.env,
      OPENCODE_SERVER_USERNAME: SERVER_USERNAME,
      OPENCODE_SERVER_PASSWORD: password,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const resolved = resolveProcessCommand(options.executable, options.cwd ?? process.cwd(), environment);
  if (!resolved.found) {
    throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'opencode-server', harness: 'opencode', message: 'Could not start the local OpenCode server.', retryable: true });
  }
  const subprocess = execa(resolved.file, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: environment,
    extendEnv: false,
    shell: false,
    windowsHide: true,
    reject: false,
    cleanup: true,
    killDescendants: true,
    encoding: 'utf8',
  });
  void subprocess.catch(() => undefined);

  let settled = false;
  const stop = () => {
    if (settled) return;
    settled = true;
    stopProcess(subprocess);
  };
  const unbind = bindAbort(options.signal, stop);

  try {
    const url = await waitForListenUrl(subprocess, timeoutMs, options.signal);
    return {
      url,
      password,
      close() {
        unbind();
        stop();
      },
    };
  } catch (error) {
    unbind();
    stop();
    if (options.signal?.aborted) {
      throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'opencode-server', harness: 'opencode', message: 'Generation canceled.' });
    }
    throw error instanceof AiOperationError
      ? error
      : new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'opencode-server', harness: 'opencode', message: 'Could not start the local OpenCode server.', retryable: true });
  }
}

export async function generateOpenCodeV2Text(server: OpenCodeV2Server, input: {
  prompt: string;
  model: string;
  cwd: string;
  signal: AbortSignal;
}): Promise<string> {
  const signal = input.signal;
  const model = input.model === 'default' ? undefined : parseOpenCodeV2ModelRef(input.model);
  const created = await v2Request(server, '/api/session', {
    method: 'POST',
    body: {
      title: 'OpenTig commit message',
      location: { directory: input.cwd },
      ...(model ? { model } : {}),
    },
    signal,
  });
  throwIfV2Failed(created.status, created.payload, signal);
  const sessionId = parseOpenCodeV2SessionId(created.payload);
  try {
    // Stateless /api/generate rejects catalog models as unavailable. Session
    // generate uses the same default/catalog and returns the assistant text.
    const response = await v2Request(server, `/api/session/${sessionId}/generate`, {
      method: 'POST',
      body: { prompt: input.prompt },
      signal,
    });
    throwIfV2Failed(response.status, response.payload, signal);
    return parseOpenCodeV2GenerateText(response.payload);
  } finally {
    await v2Request(server, `/api/session/${sessionId}`, { method: 'DELETE', signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
  }
}

async function v2Request(server: OpenCodeV2Server, pathname: string, options: {
  method?: string;
  body?: unknown;
  signal: AbortSignal;
}): Promise<{ status: number; payload: unknown }> {
  const url = new URL(pathname, server.url.endsWith('/') ? server.url : `${server.url}/`);
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${SERVER_USERNAME}:${server.password}`).toString('base64')}`,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const init: RequestInit = { method: options.method ?? 'GET', headers, signal: options.signal };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (options.signal.aborted) {
      throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'opencode-generate', harness: 'opencode', message: 'Generation canceled.' });
    }
    throw new AiOperationError({
      code: error instanceof Error && error.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_PROCESS_FAILED',
      operation: 'opencode-generate',
      harness: 'opencode',
      message: error instanceof Error && error.name === 'TimeoutError' ? 'Generation took too long.' : 'OpenCode could not generate the message.',
      retryable: true,
    });
  }
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function throwIfV2Failed(status: number, payload: unknown, signal: AbortSignal): void {
  if (status >= 200 && status < 300) return;
  if (signal.aborted) throw new AiOperationError({ code: 'AI_CANCELLED', operation: 'opencode-generate', harness: 'opencode', message: 'Generation canceled.' });
  const message = payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string' ? payload.message : '';
  const raw = message.toLowerCase();
  if (status === 401 || /not logged|login required|unauth|authentication|sign in/.test(raw)) {
    throw new AiOperationError({ code: 'AI_AUTH_REQUIRED', operation: 'opencode-generate', harness: 'opencode', message: 'Sign in to OpenCode to generate the message.' });
  }
  if (/rate.?limit|quota|usage limit|too many requests|credit/.test(raw)) {
    throw new AiOperationError({ code: 'AI_RATE_LIMITED', operation: 'opencode-generate', harness: 'opencode', message: 'OpenCode rejected the request because of a usage limit.', retryable: true });
  }
  if (/model.*(not found|unavailable|invalid|access)|unknown model|no model specified/.test(raw)) {
    throw new AiOperationError({ code: 'AI_MODEL_UNAVAILABLE', operation: 'opencode-generate', harness: 'opencode', message: 'The selected model is unavailable.' });
  }
  throw new AiOperationError({ code: 'AI_PROCESS_FAILED', operation: 'opencode-generate', harness: 'opencode', message: 'OpenCode could not generate the message.', retryable: true });
}

async function waitForListenUrl(subprocess: OpenCodeChild, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return await new Promise((resolve, reject) => {
    let output = '';
    let finished = false;
    const timer = setTimeout(() => finish(new AiOperationError({
      code: 'AI_TIMEOUT', operation: 'opencode-server', harness: 'opencode', message: 'Could not start the local OpenCode server.', retryable: true,
    })), timeoutMs);
    const child = subprocess.nodeChildProcess;
    const onData = (chunk: Buffer | string) => {
      if (finished) return;
      output += chunk.toString();
      const match = LISTEN_PATTERN.exec(output);
      const listenUrl = match?.[1];
      if (listenUrl) finish(undefined, listenUrl.replace(/[.,;]+$/, ''));
    };
    const onExit = (code: number | null) => {
      finish(new AiOperationError({
        code: 'AI_PROCESS_FAILED', operation: 'opencode-server', harness: 'opencode',
        message: output.trim() ? `Could not start the local OpenCode server.\n${output.trim()}` : 'Could not start the local OpenCode server.',
        retryable: true,
        ...(typeof code === 'number' ? { exitCode: code } : {}),
      }));
    };
    const finish = (error?: AiOperationError, url?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      subprocess.stdout?.off('data', onData);
      subprocess.stderr?.off('data', onData);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(url ?? '');
    };
    subprocess.stdout?.on('data', onData);
    subprocess.stderr?.on('data', onData);
    child.on('exit', onExit);
    if (signal?.aborted) finish(new AiOperationError({ code: 'AI_CANCELLED', operation: 'opencode-server', harness: 'opencode', message: 'Generation canceled.' }));
  });
}

function bindAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => undefined;
  const abort = () => onAbort();
  signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function stopProcess(subprocess: OpenCodeChild): void {
  const child = subprocess.nodeChildProcess;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    if (!killed.error && killed.status === 0) return;
  }
  subprocess.kill();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}
