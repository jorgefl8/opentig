import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Options as TrashOptions } from 'trash';

export interface TrashAdapter {
  readonly available: boolean;
  trashItem(target: string): Promise<void>;
}

type TrashOperation = (input: string | readonly string[], options?: TrashOptions) => Promise<void>;

export class SystemTrash implements TrashAdapter {
  readonly available: boolean;
  private readonly operation: TrashOperation;

  constructor(
    operation?: TrashOperation,
    platform: NodeJS.Platform = process.platform,
    modulePath?: string,
  ) {
    this.operation = operation ?? ((input, options) => moveToSystemTrash(input, options, modulePath));
    this.available = platform === 'win32' || platform === 'darwin' || platform === 'linux';
  }

  async trashItem(target: string): Promise<void> {
    if (!this.available) throw new Error('System Trash is not supported on this platform.');
    if (!path.isAbsolute(target)) throw new Error('System Trash requires an absolute path.');
    await lstat(target);
    try {
      await this.operation([target], { glob: false });
    } catch (cause) {
      throw new Error('Could not move the item to system Trash.', { cause });
    }
    try {
      await lstat(target);
    } catch (error) {
      if (isMissingPath(error)) return;
      throw error;
    }
    throw new Error('System Trash did not remove the source item.');
  }
}

async function moveToSystemTrash(
  input: string | readonly string[],
  options?: TrashOptions,
  modulePath?: string,
): Promise<void> {
  const { default: trash } = modulePath
    ? await import(pathToFileURL(modulePath).href)
    : await import('trash');
  await trash(input, options);
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
