import process from 'node:process';
import { runCli } from './cli';
import { devCliArguments } from './dev-config';

try {
  process.exitCode = await runCli(devCliArguments(process.argv.slice(2)), {}, undefined, 'dev');
} catch (error) {
  process.stderr.write(`OpenTig Dev: ${error instanceof Error ? error.message : 'Could not initialize the Dev profile.'}\n`);
  process.exitCode = 1;
}
