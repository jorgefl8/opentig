import { delimiter, extname, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { whichCommandSync } from 'which-command';

export interface ResolvedProcessCommand {
  file: string;
  found: boolean;
}

/**
 * Execa resolves Windows command shims for us, but an unresolved command is
 * executed through cmd.exe and looks like an ordinary exit code 1. Retain the
 * previous spawn-error contract by remembering whether the command exists.
 */
export function resolveProcessCommand(command: string, cwd: string, environment: Readonly<Record<string, string>>): ResolvedProcessCommand {
  if (process.platform !== 'win32') return { file: command, found: true };
  const pathValue = environmentValue(environment, 'PATH') ?? '';
  const pathExt = environmentValue(environment, 'PATHEXT');
  const resolved = whichCommandSync(command, {
    cwd,
    path: pathValue,
    ...(pathExt ? { pathExt } : {}),
  });
  if (resolved) return { file: resolved, found: true };
  return { file: command, found: exactFileExists(command, cwd, pathValue) };
}

function environmentValue(environment: Readonly<Record<string, string>>, name: string): string | undefined {
  const key = Object.keys(environment).sort().find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : environment[key];
}

function exactFileExists(command: string, cwd: string, pathValue: string): boolean {
  if (extname(command) === '') return false;
  const containsPath = command.includes('/') || command.includes('\\') || command.includes(':');
  const directories = containsPath ? [''] : [cwd, ...pathValue.split(delimiter).filter(Boolean)];
  return directories.some((directory) => {
    const candidate = containsPath ? resolve(cwd, command) : resolve(cwd, directory.replace(/^"|"$/g, ''), command);
    try { return statSync(candidate).isFile(); } catch { return false; }
  });
}
