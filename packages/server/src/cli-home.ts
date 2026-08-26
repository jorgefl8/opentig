import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const RUNTIME_STATE_VERSION = 1;

export interface OpenTigCliPaths {
  home: string;
  settings: string;
  aiLog: string;
  serverData: string;
  logs: string;
  serverLog: string;
  runtimeState: string;
  adminToken: string;
}

export interface OpenTigRuntimeState {
  version: typeof RUNTIME_STATE_VERSION;
  pid: number;
  host: string;
  port: number;
  protocolVersion: number;
  appVersion: string;
  instanceId: string;
  startedAt: string;
}

export function resolveCliPaths(home: string): OpenTigCliPaths {
  const resolved = path.resolve(home);
  const serverData = path.join(resolved, 'server');
  const logs = path.join(resolved, 'logs');
  return {
    home: resolved,
    settings: path.join(resolved, 'settings.json'),
    aiLog: path.join(resolved, 'ai-log.jsonl'),
    serverData,
    logs,
    serverLog: path.join(logs, 'server.log'),
    runtimeState: path.join(resolved, 'runtime.json'),
    adminToken: path.join(serverData, 'admin-token'),
  };
}

export async function prepareCliHome(paths: OpenTigCliPaths): Promise<void> {
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await chmod(paths.home, 0o700);
  await Promise.all([
    mkdir(paths.serverData, { recursive: true, mode: 0o700 }),
    mkdir(paths.logs, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([chmod(paths.serverData, 0o700), chmod(paths.logs, 0o700)]);
}

export async function loadOrCreateAdminToken(filePath: string): Promise<string> {
  try {
    return await readAdminToken(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const token = randomBytes(32).toString('base64url');
  await writePrivateAtomic(filePath, `${token}\n`);
  return token;
}

export async function readAdminToken(filePath: string): Promise<string> {
  const token = (await readFile(filePath, 'utf8')).trim();
  if (!isToken(token)) throw new Error('OpenTig local admin credential is corrupt.');
  await chmod(filePath, 0o600);
  return token;
}

export async function writeRuntimeState(filePath: string, state: Omit<OpenTigRuntimeState, 'version'>): Promise<void> {
  await writePrivateAtomic(filePath, `${JSON.stringify({ version: RUNTIME_STATE_VERSION, ...state }, null, 2)}\n`);
}

export async function readRuntimeState(filePath: string): Promise<OpenTigRuntimeState> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('No running OpenTig server was found for this home.');
    throw new Error('OpenTig runtime state is unreadable.', { cause: error });
  }
  if (!isRuntimeState(value)) throw new Error('OpenTig runtime state is invalid.');
  await chmod(filePath, 0o600);
  return value;
}

export async function clearRuntimeState(filePath: string, instanceId: string): Promise<void> {
  try {
    const state = await readRuntimeState(filePath);
    if (state.instanceId === instanceId) await rm(filePath, { force: true });
  } catch (error) {
    if (!(error instanceof Error && error.message === 'No running OpenTig server was found for this home.')) throw error;
  }
}

export function newInstanceId(): string {
  return randomBytes(24).toString('base64url');
}

async function writePrivateAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function isToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isRuntimeState(value: unknown): value is OpenTigRuntimeState {
  const state = value as Partial<OpenTigRuntimeState> | null;
  return Boolean(state
    && state.version === RUNTIME_STATE_VERSION
    && Number.isSafeInteger(state.pid) && Number(state.pid) > 0
    && typeof state.host === 'string' && state.host.length > 0 && state.host.length <= 255
    && Number.isSafeInteger(state.port) && Number(state.port) > 0 && Number(state.port) <= 65_535
    && Number.isSafeInteger(state.protocolVersion) && Number(state.protocolVersion) > 0
    && typeof state.appVersion === 'string' && state.appVersion.length > 0 && state.appVersion.length <= 128
    && typeof state.instanceId === 'string' && /^[A-Za-z0-9_-]{32}$/.test(state.instanceId)
    && typeof state.startedAt === 'string' && !Number.isNaN(Date.parse(state.startedAt)));
}
