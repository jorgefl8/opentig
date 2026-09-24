import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderSystemdUnit } from './cli-service';

describe('OpenTig systemd service', () => {
  it('pins the staged Node CLI and keeps startup configuration explicit', () => {
    const unit = renderSystemdUnit({
      nodeExecutable: '/usr/bin/node',
      cliEntrypoint: '/home/me/.opentig/service/app-0.1.0/dist/bin.mjs',
      host: '127.0.0.1',
      port: 6767,
      home: '/home/me/.opentig',
    });
    expect(unit).toContain('ExecStart="/usr/bin/node" "/home/me/.opentig/service/app-0.1.0/dist/bin.mjs" "serve" "--host" "127.0.0.1" "--port" "6767" "--home" "/home/me/.opentig"');
    expect(unit).toContain('WorkingDirectory=/home/me/.opentig/\n');
    expect(unit).toContain('KillSignal=SIGTERM');
    expect(unit).not.toContain('token');
  });

  it('escapes systemd specifiers and quotes', () => {
    const unit = renderSystemdUnit({
      nodeExecutable: '/opt/node', cliEntrypoint: '/tmp/open%tig/bin.mjs',
      host: '127.0.0.1', port: 6767, home: '/tmp/a"b',
    });
    expect(unit).toContain('/tmp/open%%tig/bin.mjs');
    expect(unit).toContain('/tmp/a\\"b');
  });

  it.skipIf(process.platform !== 'linux' || spawnSync('systemd-analyze', ['--version']).status !== 0)('generates a service accepted by the real systemd parser', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'opentig-unit-'));
    try {
      const file = path.join(directory, 'opentig-fixture.service');
      writeFileSync(file, renderSystemdUnit({
        nodeExecutable: process.execPath, cliEntrypoint: '/tmp/opentig/bin.mjs',
        host: '127.0.0.1', port: 6767, home: '/tmp/OpenTig spaces "quotes" %percent backslash\\',
      }));
      const result = spawnSync('systemd-analyze', ['verify', '--man=no', file], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
