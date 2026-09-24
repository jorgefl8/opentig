#!/usr/bin/env node
import process from 'node:process';
import { runCli } from './cli';
import { fileURLToPath } from 'node:url';
import { delegateToService } from './cli-launcher';

try {
  const args = process.argv.slice(2);
  process.exitCode = await delegateToService(args, fileURLToPath(import.meta.url)) ?? await runCli(args);
} catch {
  process.stderr.write('OpenTig: Could not launch the managed service version. Check the service installation.\n');
  process.exitCode = 1;
}
