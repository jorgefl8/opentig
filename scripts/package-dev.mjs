import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

if (!process.env.npm_execpath) throw new Error('Run this script through npm run package:dev or npm run make:dev.');
const command = process.argv[2] === 'make' ? 'make' : 'package';
const child = spawn(process.execPath, [process.env.npm_execpath, 'run', command, '--', ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: { ...process.env, OPENTIG_BUILD_PROFILE: 'dev' },
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
