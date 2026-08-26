import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export function backupPathFor(filePath: string): string {
  return `${filePath}.bak`;
}

export async function writeFileAtomically(
  filePath: string,
  contents: string,
  options: { parseJson?: boolean; directoryMode?: number } = {},
): Promise<void> {
  if (options.parseJson) JSON.parse(contents);
  const directory = path.dirname(filePath);
  await mkdir(directory, {
    recursive: true,
    ...(options.directoryMode === undefined ? {} : { mode: options.directoryMode }),
  });
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
