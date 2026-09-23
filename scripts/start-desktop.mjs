import { spawn } from 'node:child_process';
import electron from 'electron';
import { buildDesktop, repositoryRoot } from './build-desktop.mjs';

// Source starts always use Dev, regardless of a caller's production build environment.
await buildDesktop('dev');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: repositoryRoot, env: environment, stdio: 'inherit' });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  process.exitCode = code ?? 1;
});
