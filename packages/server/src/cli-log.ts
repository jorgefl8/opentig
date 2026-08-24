import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { redactSensitiveText } from '../../../src/shared/redaction';
import type { OpenTigServerLogger } from './http';

const MAX_BYTES = 1024 * 1024;
const BACKUPS = 3;

export class CliServerLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  readonly logger: OpenTigServerLogger = (level, message) => {
    const line = `${new Date().toISOString()} [${level}] ${redactSensitiveText(message)}\n`;
    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      if (await wouldExceed(this.filePath, Buffer.byteLength(line))) await this.rotate();
      await appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    }).catch(() => undefined);
  };

  close(): Promise<void> {
    return this.queue;
  }

  private async rotate(): Promise<void> {
    await rm(`${this.filePath}.${BACKUPS}`, { force: true });
    for (let index = BACKUPS - 1; index >= 1; index -= 1) {
      await moveIfPresent(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`);
    }
    await moveIfPresent(this.filePath, `${this.filePath}.1`);
  }
}

async function wouldExceed(filePath: string, incomingBytes: number): Promise<boolean> {
  try {
    return (await stat(filePath)).size + incomingBytes > MAX_BYTES;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function moveIfPresent(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
