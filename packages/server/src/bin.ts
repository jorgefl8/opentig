#!/usr/bin/env node
import process from 'node:process';
import { runCli } from './cli';
import { fileURLToPath } from 'node:url';
import { delegateToService } from './cli-launcher';
import { diagnostic } from './cli-errors';

try {
  const args = process.argv.slice(2);
  process.exitCode = await delegateToService(args, fileURLToPath(import.meta.url)) ?? await runCli(args);
} catch (error) {
  process.stderr.write(`OpenTig: ${diagnostic(error)}\n`);
  process.exitCode = 1;
}
