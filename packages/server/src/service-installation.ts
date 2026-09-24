import { execFile } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export const execute = promisify(execFile);
export const SERVICE_NAME = 'opentig.service';
export const serviceUnitPath = () => path.join(os.homedir(), '.config/systemd/user', SERVICE_NAME);
export interface ServiceInstallation {
  schema: 1;
  version: string;
  layout: 'flat' | 'npm';
  host: string;
  port: number;
  node: string;
  environmentPath?: string | undefined;
}
export const stableVersion = (value: unknown): value is string => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
export function newerVersion(a: string, b: string): boolean {
  if (!stableVersion(a) || !stableVersion(b)) return false;
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]!;
  return false;
}
export function packageDirectory(home: string, install: ServiceInstallation): string {
  if (!stableVersion(install.version) || !['flat', 'npm'].includes(install.layout)) throw new Error('Invalid managed service version.');
  const base = path.join(home, 'service', `app-${install.version}`);
  return install.layout === 'flat' ? base : path.join(base, 'node_modules/@opentig/cli');
}
export async function readInstallation(home: string): Promise<ServiceInstallation | null> {
  let value: ServiceInstallation;
  try { value = JSON.parse(await readFile(path.join(home, 'service/installation.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (value.schema !== 1 || !stableVersion(value.version) || !['flat', 'npm'].includes(value.layout)
    || typeof value.host !== 'string' || !/^[a-zA-Z0-9.:[\]-]+$/.test(value.host)
    || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
    || (value.environmentPath !== undefined && (typeof value.environmentPath !== 'string' || /[\0\r\n]/.test(value.environmentPath)))
    || typeof value.node !== 'string' || !path.isAbsolute(value.node) || /[\0\r\n]/.test(value.node)) throw new Error('Invalid managed service installation.');
  return value;
}
export async function atomicWrite(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, file);
}
export async function saveInstallation(home: string, installation: ServiceInstallation): Promise<void> {
  await atomicWrite(path.join(home, 'service/installation.json'), JSON.stringify(installation));
}
export async function systemctl(...args: string[]): Promise<string> {
  return (await execute('systemctl', ['--user', ...args], { timeout: 30_000 })).stdout.trim();
}
