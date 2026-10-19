import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Locate the npm CLI bundled with the running Node.js, independent of the workspace package manager. */
export function bundledNpm(nodeExecutable = process.execPath) {
  const nodeDirectory = path.dirname(nodeExecutable);
  const directory = [
    path.join(nodeDirectory, 'node_modules', 'npm'),
    path.join(nodeDirectory, '..', 'lib', 'node_modules', 'npm'),
  ].find((candidate) => existsSync(path.join(candidate, 'bin', 'npm-cli.js')));
  if (!directory) throw new Error('Could not find the npm CLI bundled with Node.js.');
  const { version } = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  return { cli: path.join(directory, 'bin', 'npm-cli.js'), version };
}
