import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Account-free fixture shared by packaged Node and Electron utility checks. */
export async function verifyCliDiscovery(socket, directory) {
  let sequence = 0;
  const request = (command, args) => new Promise((resolve, reject) => {
    const id = `cli-smoke-${++sequence}`;
    const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error('CLI discovery smoke timed out.')); }, 20_000);
    function receive(data) {
      const message = JSON.parse(data.toString());
      if (message.type !== 'result' || message.id !== id) return;
      clearTimeout(timeout); socket.off('message', receive);
      if (!message.result?.ok) reject(new Error('CLI discovery command failed.'));
      else resolve(message.result.value);
    }
    socket.on('message', receive);
    socket.send(JSON.stringify({ type: 'request', id, command, args }));
  });
  const bin = path.join(directory, 'CLI tools with spaces');
  const executable = path.join(bin, process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
  const paths = Object.fromEntries(['codex', 'claude', 'grok'].map((id) => [id, path.join(directory, `missing-${id}`)]));
  await request('app:preferences', [{ aiExecutablePaths: { ...paths, opencode: executable }, aiShellEnvironment: false }]);
  const before = await request('ai:statuses', [true]);
  assert.equal(before.find((status) => status.id === 'opencode').installationStatus, 'not-found');
  await mkdir(bin, { recursive: true });
  await writeFile(executable, process.platform === 'win32'
    ? '@echo off\r\nif "%~1"=="--version" goto version\r\nif "%~1"=="auth" goto auth\r\necho fixture/model\r\nexit /b 0\r\n:version\r\necho 2.0.22\r\nexit /b 0\r\n:auth\r\necho []\r\n'
    : '#!/bin/sh\ncase "$1" in --version) echo 2.0.22;; auth) echo "[]";; *) echo fixture/model;; esac\n', { mode: 0o755 });
  const after = await request('ai:statuses', [true]);
  const detected = after.find((status) => status.id === 'opencode');
  assert.equal(detected.installationStatus, 'available');
  assert.equal(detected.executablePath, executable);
  assert.equal(detected.version, '2.0.22');
  assert.equal(detected.models[1].id, 'fixture/model');
  process.stdout.write(`PACKAGED_CLI_DISCOVERY_OK ${process.platform} ${process.arch}\n`);
}
