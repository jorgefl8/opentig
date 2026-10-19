import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath } from 'node:url';

const command = process.argv[2] === 'make' ? 'make' : 'package';
const packager = fileURLToPath(new URL('./package-desktop.mjs', import.meta.url));
const child = spawn(process.execPath, [packager, command, ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: { ...process.env, OPENTIG_BUILD_PROFILE: 'dev' },
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
